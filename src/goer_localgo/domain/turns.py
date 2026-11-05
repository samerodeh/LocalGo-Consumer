"""Durable, fenced turn journal. SQLite requires shared durable storage per deployment.

Never store credentials. A planned command is immutable across retries; response
and conversation history commit together. Replace this adapter for multi-host
production, rather than using separate local SQLite files on each worker host.
"""
import hashlib
import json
import time
from dataclasses import dataclass
from uuid import uuid4

from goer_localgo.domain.conversations import (
    ConversationConflict, ConversationNotFound, SQLiteConversationRepository, conversation_db_path,
)


class TurnPending(Exception):
    pass


@dataclass
class TurnRecord:
    owner: str
    conversation_id: str
    request_id: str
    lease: str
    context: dict
    plan: dict | None
    result: dict | None
    response: dict | None


class TurnJournal:
    def __init__(self):
        self.storage = SQLiteConversationRepository(conversation_db_path())
        with self.storage._connect() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS chat_turns (
                owner TEXT NOT NULL, conversation_id TEXT NOT NULL, request_id TEXT NOT NULL,
                message_hash TEXT NOT NULL, status TEXT NOT NULL, lease TEXT NOT NULL,
                lease_until REAL NOT NULL, context TEXT NOT NULL, plan TEXT, result TEXT, response TEXT,
                PRIMARY KEY(owner, conversation_id, request_id))""")
            db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS one_pending_turn
                ON chat_turns(owner, conversation_id) WHERE status != 'completed'""")

    def begin(self, owner: str, conversation_id: str, request_id: str, message: str) -> TurnRecord:
        fingerprint = hashlib.sha256(message.encode()).hexdigest()
        lease = str(uuid4())
        with self.storage._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            conversation = db.execute("SELECT snapshot FROM conversations WHERE id=? AND user_id=?",
                                      (conversation_id, owner)).fetchone()
            if conversation is None:
                raise ConversationNotFound(conversation_id)
            row = db.execute("""SELECT message_hash,status,lease_until,context,plan,result,response
                FROM chat_turns WHERE owner=? AND conversation_id=? AND request_id=?""",
                (owner, conversation_id, request_id)).fetchone()
            if row:
                if row[0] != fingerprint:
                    raise ConversationConflict("Request ID was already used for another message.")
                context = json.loads(row[3])
                plan = json.loads(row[4]) if row[4] else None
                result = json.loads(row[5]) if row[5] else None
                response = json.loads(row[6]) if row[6] else None
                if row[1] == "completed":
                    return TurnRecord(owner, conversation_id, request_id, lease, context, plan, result, response)
                if row[2] > time.time():
                    raise TurnPending("This turn is still running. Retry the same request ID shortly.")
                db.execute("""UPDATE chat_turns SET lease=?,lease_until=?
                    WHERE owner=? AND conversation_id=? AND request_id=?""",
                    (lease, time.time() + 120, owner, conversation_id, request_id))
            else:
                active = db.execute("SELECT 1 FROM chat_turns WHERE owner=? AND conversation_id=? AND status!='completed'",
                                    (owner, conversation_id)).fetchone()
                if active:
                    raise ConversationConflict("Finish or reconcile the previous turn before sending another.")
                context, plan, result, response = json.loads(conversation[0]), None, None, None
                db.execute("""INSERT INTO chat_turns
                    (owner,conversation_id,request_id,message_hash,status,lease,lease_until,context)
                    VALUES (?,?,?,?,?,?,?,?)""",
                    (owner, conversation_id, request_id, fingerprint, "planning", lease,
                     time.time() + 120, json.dumps(context)))
        return TurnRecord(owner, conversation_id, request_id, lease, context, plan, result, response)

    def _update(self, record: TurnRecord, sql: str, values: tuple):
        with self.storage._connect() as db:
            changed = db.execute(sql + " WHERE owner=? AND conversation_id=? AND request_id=? AND lease=? AND status!='completed'",
                                 (*values, record.owner, record.conversation_id, record.request_id, record.lease))
            if changed.rowcount != 1:
                raise TurnPending("Another worker is reconciling this turn. Retry the same request ID.")

    def stage(self, record: TurnRecord, plan: dict):
        self._update(record, "UPDATE chat_turns SET plan=?,status='planned'", (json.dumps(plan),))
        record.plan = plan

    def applying(self, record: TurnRecord):
        self._update(record, "UPDATE chat_turns SET status='applying',lease_until=?", (time.time() + 120,))

    def applied(self, record: TurnRecord, result: dict):
        self._update(record, "UPDATE chat_turns SET result=?,status='applied'", (json.dumps(result),))
        record.result = result

    def release(self, record: TurnRecord):
        self._update(record, "UPDATE chat_turns SET lease_until=0", ())

    def finish(self, record: TurnRecord, response: dict, snapshot: dict) -> dict:
        with self.storage._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT response,lease FROM chat_turns WHERE owner=? AND conversation_id=? AND request_id=?",
                             (record.owner, record.conversation_id, record.request_id)).fetchone()
            if row and row[0]:
                return json.loads(row[0])
            if not row or row[1] != record.lease:
                raise TurnPending("Another worker is completing this turn. Retry the same request ID.")
            updated = db.execute("UPDATE conversations SET snapshot=?,revision=revision+1 WHERE id=? AND user_id=?",
                                 (json.dumps(snapshot), record.conversation_id, record.owner))
            if updated.rowcount != 1:
                raise ConversationNotFound(record.conversation_id)
            db.execute("""UPDATE chat_turns SET response=?,status='completed',lease_until=0
                WHERE owner=? AND conversation_id=? AND request_id=?""",
                (json.dumps(response), record.owner, record.conversation_id, record.request_id))
        return response
