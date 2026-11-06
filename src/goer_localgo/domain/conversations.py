"""Application-owned sessions, independent of CrewAI execution/checkpoint IDs.

Storage is SQLite by default and Postgres when GOER_DATABASE_URL is set (see
``storage.py``). The compare-and-swap revision prevents lost context updates
across processes; rejected turns have no persisted effect.
"""

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from goer_localgo.domain.storage import Database, SQLiteDatabase, conversation_db_path, get_database

__all__ = [
    "Conversation", "ConversationConflict", "ConversationNotFound", "ConversationRepository",
    "SQLConversationRepository", "SQLiteConversationRepository", "conversation_db_path",
    "get_conversation_repository",
]


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


class SQLConversationRepository:
    def __init__(self, database: Database):
        self.database = database

    def create(self, user_id: str) -> Conversation:
        conversation = Conversation(str(uuid4()), user_id, 0, {})
        with self.database.transaction() as tx:
            tx.execute("INSERT INTO {conversations} (id, user_id, snapshot, updated_at) VALUES (?, ?, ?, ?)",
                       (conversation.id, user_id, "{}", time.time()))
        return conversation

    def load(self, conversation_id: str, user_id: str) -> Conversation:
        with self.database.transaction() as tx:
            row = tx.execute(
                "SELECT revision, snapshot FROM {conversations} WHERE id = ? AND user_id = ?",
                (conversation_id, user_id),
            ).fetchone()
        if row is None:
            # Missing and wrong-owner IDs are indistinguishable.
            raise ConversationNotFound(conversation_id)
        return Conversation(conversation_id, user_id, row[0], json.loads(row[1]))

    def save(self, conversation: Conversation, snapshot: dict[str, Any]) -> None:
        with self.database.transaction() as tx:
            result = tx.execute("""UPDATE {conversations}
                SET snapshot = ?, revision = revision + 1, updated_at = ?
                WHERE id = ? AND user_id = ? AND revision = ?""",
                (json.dumps(snapshot, ensure_ascii=False), time.time(), conversation.id,
                 conversation.user_id, conversation.revision),
            )
            if result.rowcount != 1:
                raise ConversationConflict("Conversation changed while answering; retry your message.")

    def delete_user_data(self, user_id: str) -> int:
        """Remove every conversation and journaled turn owned by ``user_id``."""
        with self.database.transaction(immediate=True) as tx:
            tx.execute("DELETE FROM {chat_turns} WHERE owner = ?", (user_id,))
            return tx.execute("DELETE FROM {conversations} WHERE user_id = ?", (user_id,)).rowcount

    def purge_inactive(self, max_age_days: float, *, now: float | None = None) -> int:
        """Delete conversations (and their turns) untouched for ``max_age_days``.

        Conversations with an unfinished turn are kept so an in-flight cart
        command can still be reconciled with its original request ID.
        """
        cutoff = (now if now is not None else time.time()) - max_age_days * 86400
        with self.database.transaction(immediate=True) as tx:
            stale = """SELECT id FROM {conversations} c WHERE c.updated_at < ?
                AND NOT EXISTS (SELECT 1 FROM {chat_turns} t
                    WHERE t.conversation_id = c.id AND t.status <> 'completed')"""
            tx.execute(f"DELETE FROM {{chat_turns}} WHERE conversation_id IN ({stale})", (cutoff,))
            return tx.execute(f"DELETE FROM {{conversations}} WHERE id IN ({stale})", (cutoff,)).rowcount


class SQLiteConversationRepository(SQLConversationRepository):
    """Repository over one SQLite file (kept for callers that pass a path)."""

    def __init__(self, path: Path):
        super().__init__(SQLiteDatabase(path))


def get_conversation_repository() -> SQLConversationRepository:
    return SQLConversationRepository(get_database())
