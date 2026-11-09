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


def test_turn_runs_search_tool_and_returns_grounded_answer(use_stub):
    stub = use_stub(StubLLM(responses=[
        tool_call("search_menu", {"product_name": "pizza slice"}),
        final("Cheese Pizza Slice is $5.50."),
    ]))

    response = run_turn("Any pizza slices at Al-Taib?")

    assert response.startswith("1. Cheese Pizza Slice - $5.50")
    assert "Pepperoni Pizza Slice - $6.50" in response
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


def test_model_cannot_replace_catalog_card_names_or_prices(use_stub):
    use_stub(StubLLM(responses=[
        tool_call("search_menu", {"product_name": "pizza slice"}),
        final("Sushi Plate costs $1.00."),
    ]))
    response = run_conversation_turn("Show pizza slices")
    assert response.cards[0].items[0].name == "Cheese Pizza Slice"
    assert response.text.startswith("1. Cheese Pizza Slice - $5.50")
    assert "Sushi Plate" not in response.text
    assert "$1.00" not in response.text


def test_no_tool_result_cannot_publish_a_menu_claim(use_stub):
    use_stub(StubLLM(responses=[final("A sushi plate is $1.00.")]))
    response = run_conversation_turn("What sushi do you have?")
    assert response.cards == []
    assert response.text.startswith("I couldn't verify")


def test_turn_with_no_tool_call_answers_directly(use_stub):
    stub = use_stub(StubLLM(responses=[final("Which restaurant do you mean?")]))

    assert run_turn("food") == "Which restaurant do you mean?"
    assert len(stub.calls) == 1


def test_chat_endpoint_returns_flow_response(use_stub):
    use_stub(StubLLM(responses=[final("Which restaurant would you like to browse?")]))

    response = TestClient(app).post(
        "/v1/chat", json={"message": "Show me Chateau Kabab's menu"}
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Which restaurant would you like to browse?"


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
    assert first.text.splitlines()[0] in prompt
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


def test_clarification_keeps_references_but_empty_search_clears_them(use_stub):
    stub = use_stub(StubLLM(responses=[
        tool_call("get_menu", {"merchant_id": "al-taib"}), final("First five."),
        final("What would you like to know?"),
        tool_call("search_menu", {"product_name": "no-such-food-xyz"}), final("No matches."),
        final("Please choose a product."),
    ]))
    conversation_id = create_conversation()
    first = run_conversation_turn("menu", conversation_id)
    ids = [item.product_id for item in first.cards[0].items]
    run_conversation_turn("clarify please", conversation_id)
    assert get_conversation_repository().load(conversation_id, "demo-user").snapshot["last_shown_product_ids"] == ids
    run_conversation_turn("search for no-such-food-xyz", conversation_id)
    run_conversation_turn("the second one", conversation_id)
    assert '"last_shown_products": []' in prompt_text(stub.calls[-1])


def test_simultaneous_turns_cannot_overwrite_each_other(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    from types import SimpleNamespace

    from goer_localgo.domain.conversations import ConversationConflict
    from goer_localgo.tools.catalog_tools import SearchMenuTool

    barrier = Barrier(2)

    class ConcurrentCrew:
        def kickoff(self, inputs):
            barrier.wait(timeout=10)
            SearchMenuTool()._run("pizza")
            return SimpleNamespace(raw=inputs["user_message"])

    monkeypatch.setattr(DiscoveryCrew, "crew", lambda self: ConcurrentCrew())
    conversation_id = create_conversation()

    def send(message):
        try:
            return run_conversation_turn(message, conversation_id)
        except ConversationConflict:
            return None

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(send, ["first", "second"]))
    successful = [response for response in responses if response is not None]
    assert len(successful) == 1
    assert successful[0].cards[0].items
    saved = get_conversation_repository().load(conversation_id, "demo-user")
    assert saved.revision == 1
    assert saved.snapshot["recent_turns"][0]["text"] in {"first", "second"}
    assert saved.snapshot["recent_turns"][1]["text"] == successful[0].text
