from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from stub_llm import StubLLM, prompt_text, tool_call

from goer_localgo.api.main import app
from goer_localgo.domain.conversations import ConversationConflict
from goer_localgo.flow.goer_flow import create_conversation
from goer_localgo.schemas.chat import ChatEnvelope


client = TestClient(app)


def test_conversation_api_preserves_memory_and_cards(use_stub):
    stub = use_stub(StubLLM(responses=[
        tool_call("get_menu", {"merchant_id": "al-taib"}),
        "Final Answer: Here are the first five items.",
        "Final Answer: What would you like to know?",
    ]))
    created = client.post("/v1/conversations")
    assert created.status_code == 201
    conversation_id = created.json()["conversation_id"]
    path = f"/v1/conversations/{conversation_id}/turns"
    first = client.post(path, json={"message": "Show Al-Taib's menu"})
    assert first.status_code == 200
    envelope = ChatEnvelope.model_validate(first.json())
    assert str(envelope.conversation_id) == conversation_id
    assert envelope.cards[0].items
    second = client.post(path, json={"message": "The second one?"})
    assert second.status_code == 200
    assert envelope.cards[0].items[1].product_id in prompt_text(stub.calls[2])


def test_legacy_chat_retains_shape_and_can_continue(use_stub):
    stub = use_stub(StubLLM(responses=["Final Answer: Hello.", "Final Answer: Welcome back."]))
    first = client.post("/api/chat", json={"messages": [{"role": "user", "content": "pizza"}]})
    assert first.status_code == 200
    assert first.json()["user_id"] == "demo-user"
    assert first.json()["message"] == "Hello."
    second = client.post("/v1/chat", json={
        "conversation_id": first.json()["conversation_id"], "message": "What did I ask?",
    })
    assert second.status_code == 200
    assert "pizza" in prompt_text(stub.calls[1])


@pytest.mark.parametrize("message", ["", "  ", "a" * 4001])
def test_new_and_legacy_history_inputs_validate_message(message):
    conversation_id = client.post("/v1/conversations").json()["conversation_id"]
    assert client.post(f"/v1/conversations/{conversation_id}/turns",
                       json={"message": message}).status_code == 422
    assert client.post("/api/chat", json={
        "messages": [{"role": "user", "content": message}],
    }).status_code == 422


def test_unknown_malformed_and_wrong_owner_ids_do_not_run_model(use_stub):
    stub = use_stub(StubLLM())
    for conversation_id, status in [(str(uuid4()), 404), ("invalid", 422),
                                    (create_conversation("another-user"), 404)]:
        response = client.post(f"/v1/conversations/{conversation_id}/turns", json={"message": "menu"})
        assert response.status_code == status
    assert not stub.calls


def test_revision_conflict_has_explicit_status(monkeypatch):
    def conflict(*args):
        raise ConversationConflict()

    monkeypatch.setattr("goer_localgo.api.main.run_conversation_turn", conflict)
    response = client.post(f"/v1/conversations/{uuid4()}/turns", json={"message": "pizza"})
    assert response.status_code == 409


def test_new_turns_reject_identity_fields():
    response = client.post(f"/v1/conversations/{uuid4()}/turns",
                           json={"message": "pizza", "user_id": "someone-else"})
    assert response.status_code == 422
