import sqlite3

import pytest

from goer_localgo.domain.conversations import (
    ConversationConflict,
    ConversationNotFound,
    SQLiteConversationRepository,
)


def test_snapshot_survives_repository_recreation(tmp_path):
    path = tmp_path / "conversations.db"
    repo = SQLiteConversationRepository(path)
    conversation = repo.create("alice")
    repo.save(conversation, {"recent_turns": [{"role": "user", "text": "pizza"}]})
    loaded = SQLiteConversationRepository(path).load(conversation.id, "alice")
    assert loaded.revision == 1
    assert loaded.snapshot["recent_turns"][0]["text"] == "pizza"


def test_owner_and_missing_ids_are_not_found(tmp_path):
    repo = SQLiteConversationRepository(tmp_path / "conversations.db")
    conversation = repo.create("alice")
    for conversation_id, owner in [(conversation.id, "bob"), ("missing", "alice")]:
        with pytest.raises(ConversationNotFound):
            repo.load(conversation_id, owner)


def test_stale_write_is_rejected_without_overwriting(tmp_path):
    repo = SQLiteConversationRepository(tmp_path / "conversations.db")
    conversation = repo.create("alice")
    other = repo.load(conversation.id, "alice")
    repo.save(conversation, {"winner": True})
    with pytest.raises(ConversationConflict):
        repo.save(other, {"winner": False})
    assert repo.load(conversation.id, "alice").snapshot == {"winner": True}


def test_repository_closes_connections_even_on_conflict(tmp_path, monkeypatch):
    connections = []
    original = sqlite3.connect

    def track(*args, **kwargs):
        connection = original(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setattr(sqlite3, "connect", track)
    repo = SQLiteConversationRepository(tmp_path / "conversations.db")
    conversation = repo.create("alice")
    repo.save(conversation, {})
    with pytest.raises(ConversationConflict):
        repo.save(conversation, {})
    repo.load(conversation.id, "alice")
    for connection in connections:
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            connection.execute("SELECT 1")
