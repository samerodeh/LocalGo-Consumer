from fastapi.testclient import TestClient
from stub_llm import StubLLM

from goer_localgo.api import main as api
from goer_localgo.api.guards import CARD_REFUSAL

client = TestClient(api.app)


def test_card_numbers_are_refused_before_the_model(use_stub, monkeypatch):
    stub = use_stub(StubLLM())
    called = []
    monkeypatch.setattr(api, "run_conversation_turn", lambda *a, **k: called.append(a))
    conversation = client.post("/v1/conversations").json()["conversation_id"]

    response = client.post(f"/v1/conversations/{conversation}/turns",
                           json={"message": "pay with 4242 4242 4242 4242 cvv 123"})
    assert response.status_code == 200
    assert response.json()["text"] == CARD_REFUSAL
    assert "4242" not in response.text

    legacy = client.post("/v1/chat", json={"message": "my card 4242424242424242"})
    assert legacy.status_code == 200 and legacy.json()["message"] == CARD_REFUSAL
    assert called == [] and stub.calls == []


def test_turns_are_rate_limited_per_principal(monkeypatch):
    monkeypatch.setattr(api, "run_conversation_turn",
                        lambda message, conversation_id, user_id: api.ChatEnvelope(
                            conversation_id=conversation_id, turn_id=api.uuid4(), text="ok",
                            trace_id=api.uuid4()))
    conversation = client.post("/v1/conversations").json()["conversation_id"]
    statuses = [client.post(f"/v1/conversations/{conversation}/turns", json={"message": "hi"}).status_code
                for _ in range(21)]
    assert statuses[:20] == [200] * 20
    assert statuses[20] == 429
    limited = client.post(f"/v1/conversations/{conversation}/turns", json={"message": "hi"})
    assert int(limited.headers["Retry-After"]) >= 1
