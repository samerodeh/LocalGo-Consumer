from fastapi.testclient import TestClient

from goer_localgo.api import main as api
from goer_localgo.api.auth import Session, optional_session
from goer_localgo.domain.conversations import ConversationNotFound, get_conversation_repository
import pytest

client = TestClient(api.app)


def test_delete_requires_a_signed_in_session():
    assert client.delete("/v1/me/data").status_code == 401


def test_delete_removes_only_the_callers_goer_data():
    repo = get_conversation_repository()
    mine, theirs = repo.create("user-a"), repo.create("user-b")
    api.app.dependency_overrides[optional_session] = lambda: Session("user-a", "token", "http://127.0.0.1:8100")
    try:
        response = client.delete("/v1/me/data")
    finally:
        api.app.dependency_overrides.clear()
    assert response.status_code == 200 and response.json() == {"deleted_conversations": 1}
    with pytest.raises(ConversationNotFound):
        repo.load(mine.id, "user-a")
    assert repo.load(theirs.id, "user-b").user_id == "user-b"
