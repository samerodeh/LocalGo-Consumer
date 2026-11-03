"""Offline GoerFlow tests: the real Flow, crew, prompts, and tools run with a
deterministic stub LLM, so no API key or network access is needed."""

import pytest
from fastapi.testclient import TestClient
from stub_llm import StubLLM, prompt_text, tool_call

from goer_localgo.api.main import app
from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew
from goer_localgo.main import run_turn


@pytest.fixture
def use_stub(monkeypatch):
    """Swap the stub into every agent the DiscoveryCrew builds."""

    def install(stub: StubLLM) -> StubLLM:
        original = DiscoveryCrew.crew

        def crew_with_stub(self):
            crew = original(self)
            for agent in crew.agents:
                agent.llm = stub
            return crew

        monkeypatch.setattr(DiscoveryCrew, "crew", crew_with_stub)
        return stub

    return install


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
