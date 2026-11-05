"""Application-owned sessions, independent of CrewAI execution/checkpoint IDs.

SQLite is for local development. The compare-and-swap revision also prevents
lost context updates across processes; rejected turns have no persisted effect.
"""

import json
import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Protocol
from uuid import uuid4


class ConversationNotFound(Exception):
    pass


class ConversationConflict(Exception):
    pass


@dataclass(frozen=True)
class Conversation:
    id: str
    user_id: str
    revision: int
    snapshot: dict[str, Any]


class ConversationRepository(Protocol):
    def create(self, user_id: str) -> Conversation: ...
    def load(self, conversation_id: str, user_id: str) -> Conversation: ...
    def save(self, conversation: Conversation, snapshot: dict[str, Any]) -> None: ...


class SQLiteConversationRepository:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL
            )""")

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            # A connection's own context manager commits but does not close it.
            db.close()

    def create(self, user_id: str) -> Conversation:
        conversation = Conversation(str(uuid4()), user_id, 0, {})
        with self._connect() as db:
            db.execute("INSERT INTO conversations (id, user_id, snapshot) VALUES (?, ?, ?)",
                       (conversation.id, user_id, "{}"))
        return conversation

    def load(self, conversation_id: str, user_id: str) -> Conversation:
        with self._connect() as db:
            row = db.execute(
                "SELECT revision, snapshot FROM conversations WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            ).fetchone()
        if row is None:
            # Missing and wrong-owner IDs are indistinguishable.
            raise ConversationNotFound(conversation_id)
        return Conversation(conversation_id, user_id, row[0], json.loads(row[1]))

    def save(self, conversation: Conversation, snapshot: dict[str, Any]) -> None:
        with self._connect() as db:
            result = db.execute("""UPDATE conversations
                SET snapshot = ?, revision = revision + 1
                WHERE id = ? AND user_id = ? AND revision = ?""",
                (json.dumps(snapshot, ensure_ascii=False), conversation.id,
                 conversation.user_id, conversation.revision),
            )
            if result.rowcount != 1:
                raise ConversationConflict("Conversation changed while answering; retry your message.")


def conversation_db_path() -> Path:
    return Path(os.environ.get(
        "GOER_CONVERSATION_DB", str(Path.home() / ".localgo" / "goer" / "conversations.sqlite3")
    ))


def get_conversation_repository() -> ConversationRepository:
    return SQLiteConversationRepository(conversation_db_path())
