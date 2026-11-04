"""Offline GoerFlow tests: the real Flow, crew, prompts, and tools run with a
deterministic stub LLM, so no API key or network access is needed."""

import pytest
from fastapi.testclient import TestClient
from stub_llm import StubLLM, prompt_text, tool_call

from goer_localgo.api.main import app
from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew
from goer_localgo.main import run_turn
from goer_localgo.flow.goer_flow import create_conversation, run_conversation_turn
from goer_localgo.domain.conversations import get_conversation_repository


def final(text: str) -> str:
    return f"Thought: I can answer now.\nFinal Answer: {text}"


def test_turn_runs_search_tool_and_returns_final_answer(use_stub):
    stub = use_stub(StubLLM(responses=[
        tool_call("search_menu", {"product_name": "pizza slice"}),
        final("Cheese Pizza Slice is $5.50."),
    ]))

    response = run_turn("Any pizza slices at Al-Taib?")

    assert response == "Cheese Pizza Slice is $5.50."
    assert len(stub.calls) == 2

    first_prompt = prompt_text(stub.calls[0])
    assert "Any pizza slices at Al-Taib?" in first_prompt   # {user_message} interpolated
    for tool_name in ("search_menu", "get_menu", "get_product"):
        assert tool_name in first_prompt                     # all tools offered

    observation = prompt_text(stub.calls[1])
    assert '"display_price": "$5.50"' in observation        # real tool ran, price preformatted


def test_turn_surfaces_tool_error_codes_to_the_model(use_stub):
    stub = use_stub(StubLLM(responses=[
        tool_call("get_product", {"product_id": "not-a-product"}),
        final("Sorry, I couldn't find that item."),
    ]))

    run_turn("Tell me about the mystery dish")

    assert "PRODUCT_NOT_FOUND" in prompt_text(stub.calls[1])


def test_turn_with_no_tool_call_answers_directly(use_stub):
    stub = use_stub(StubLLM(responses=[final("Which restaurant do you mean?")]))

    assert run_turn("food") == "Which restaurant do you mean?"
    assert len(stub.calls) == 1


def test_chat_endpoint_returns_flow_response(use_stub):
    use_stub(StubLLM(responses=[final("Here is the menu.")]))

    response = TestClient(app).post(
        "/v1/chat", json={"message": "Show me Chateau Kabab's menu"}
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Here is the menu."


def test_followup_receives_displayed_ids_and_previous_messages(use_stub):
    from goer_localgo.domain.catalog import merchant_menu

    products = merchant_menu("al-taib")
    # Menu cards follow category order; use the response itself as source of truth.
    stub = use_stub(StubLLM(responses=[
        tool_call("get_menu", {"merchant_id": "al-taib"}),
        final("Here are the first five products."),
        final("Which details would you like?"),
        final("No previous products here."),
    ]))
    conversation_id = create_conversation()
    first = run_conversation_turn("Browse Al-Taib", conversation_id)
    second_id = first.cards[0].items[1].product_id
    second = run_conversation_turn("Tell me about the second one", conversation_id)
    assert second.conversation_id == first.conversation_id
    assert second.turn_id != first.turn_id
    prompt = prompt_text(stub.calls[2])
    assert second_id in prompt
    assert '"position": 2' in prompt
    assert "Browse Al-Taib" in prompt
    assert "Here are the first five products." in prompt
    assert products

    run_conversation_turn("What did I see?", create_conversation())
    other_prompt = prompt_text(stub.calls[3])
    assert second_id not in other_prompt
    assert "Browse Al-Taib" not in other_prompt


def test_followup_can_fetch_exact_second_product(use_stub):
    from goer_localgo.domain.catalog import merchant_menu

    second_id = merchant_menu("al-taib")[1]["product_id"]
    use_stub(StubLLM(responses=[
        tool_call("get_menu", {"merchant_id": "al-taib"}), final("First five."),
        tool_call("get_product", {"product_id": second_id}), final("Here are its details."),
    ]))
    conversation_id = create_conversation()
    first = run_conversation_turn("Menu please", conversation_id)
    assert first.cards[0].items[1].product_id == second_id
    second = run_conversation_turn("Details on the second one", conversation_id)
    assert second.cards[0].type == "product_detail"
    assert second.cards[0].product.product_id == second_id


def test_history_is_bounded_to_six_exchanges(use_stub):
    use_stub(StubLLM(default_response=final("Please clarify.")))
    conversation_id = create_conversation()
    for index in range(8):
        run_conversation_turn(f"Request {index}", conversation_id)
    saved = get_conversation_repository().load(conversation_id, "demo-user")
    assert len(saved.snapshot["recent_turns"]) == 12
    assert saved.snapshot["recent_turns"][0]["text"] == "Request 2"


def test_crew_failure_returns_partial_grounded_cards(monkeypatch):
    from goer_localgo.tools.catalog_tools import SearchMenuTool

    class FailingCrew:
        def kickoff(self, **kwargs):
            SearchMenuTool()._run("pizza")
            raise RuntimeError("private-provider-error")

    monkeypatch.setattr(DiscoveryCrew, "crew", lambda self: FailingCrew())
    response = run_conversation_turn("pizza")
    assert "couldn't finish" in response.text
    assert "private-provider-error" not in response.text
    assert response.cards[0].items


@pytest.mark.parametrize("message", ["", "   ", "a" * 4001])
def test_turn_rejects_invalid_message_before_model_call(use_stub, message):
    from pydantic import ValidationError

    stub = use_stub(StubLLM())
    with pytest.raises(ValidationError):
        run_conversation_turn(message)
    assert not stub.calls
