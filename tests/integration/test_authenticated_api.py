from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from goer_localgo.api import auth
from goer_localgo.api.main import app
from goer_localgo.domain.turns import TurnPending
from goer_localgo.flow.goer_flow import create_conversation
from goer_localgo.schemas.chat import ChatEnvelope


@pytest.fixture
def session():
    value = auth.Session(str(uuid4()), 'private-session', 'http://127.0.0.1:8100')
    app.dependency_overrides[auth.optional_session] = lambda: value
    try:
        yield value
    finally:
        app.dependency_overrides.pop(auth.optional_session, None)


def test_signed_in_conversations_cannot_be_claimed_through_legacy_identity(session):
    client = TestClient(app)
    conversation = client.post('/v1/conversations').json()['conversation_id']
    app.dependency_overrides.pop(auth.optional_session)
    response = client.post('/api/chat', json={'conversation_id': conversation, 'user_id': session.user_id, 'message': 'private history'})
    assert response.status_code == 404


def test_authenticated_turns_require_request_id_and_pass_private_context(session, monkeypatch):
    client = TestClient(app)
    conversation = client.post('/v1/conversations').json()['conversation_id']
    path = f'/v1/conversations/{conversation}/turns'
    assert client.post(path, json={'message': 'cart'}).status_code == 422
    request_id = str(uuid4())
    calls = []

    def execute(*args):
        calls.append(args)
        return ChatEnvelope(conversation_id=conversation, turn_id=request_id, text='Cart ready', trace_id=uuid4())

    monkeypatch.setattr('goer_localgo.api.main.run_authenticated_turn', execute)
    response = client.post(path, json={'message': 'cart', 'request_id': request_id})
    assert response.status_code == 200
    assert calls[0][3] == session.user_id
    assert calls[0][2] == request_id
    assert 'private-session' not in response.text
    assert client.post('/api/chat', json={'message': 'cart'}).status_code == 422


def test_pending_response_keeps_request_identity(session, monkeypatch):
    def pending(*args):
        raise TurnPending('Retry the same request ID.')

    monkeypatch.setattr('goer_localgo.api.main.run_authenticated_turn', pending)
    request_id = str(uuid4())
    path = f'/v1/conversations/{uuid4()}/turns'
    response = TestClient(app).post(path, json={'message': 'cart', 'request_id': request_id})
    assert response.status_code == 202
    assert response.json()['detail']['request_id'] == request_id


def test_invalid_bearer_never_falls_back_to_guest(monkeypatch):
    monkeypatch.setenv('LOCALGO_API_URL', 'http://127.0.0.1:8100')
    real_client = httpx.AsyncClient
    monkeypatch.setattr(auth.httpx, 'AsyncClient', lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(401, json={}))))
    response = TestClient(app).post('/v1/conversations', headers={'Authorization': 'Bearer forged'})
    assert response.status_code == 401
