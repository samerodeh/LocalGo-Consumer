"""Conversation and journal behaviour on every storage backend.

Postgres runs only when GOER_TEST_DATABASE_URL points at a disposable database
(CI provides one); the schema ``goer`` is dropped and recreated per test.
"""
import os
import sqlite3
import threading
import time
from uuid import uuid4

import pytest

from goer_localgo.domain.conversations import (
    ConversationConflict, ConversationNotFound, SQLConversationRepository,
)
from goer_localgo.domain.storage import PostgresDatabase, SQLiteDatabase
from goer_localgo.domain.turns import TurnJournal, TurnPending

PG_URL = os.environ.get("GOER_TEST_DATABASE_URL", "")


@pytest.fixture(params=["sqlite", "postgres"])
def database(request, tmp_path):
    if request.param == "sqlite":
        yield SQLiteDatabase(tmp_path / "goer.sqlite3")
        return
    if not PG_URL:
        pytest.skip("GOER_TEST_DATABASE_URL is not set")
    import psycopg
    with psycopg.connect(PG_URL, autocommit=True) as conn:
        conn.execute("DROP SCHEMA IF EXISTS goer CASCADE")
    db = PostgresDatabase(PG_URL, min_size=1, max_size=4)
    yield db
    db.close()


def test_conversations_are_owned_and_compare_and_swap(database):
    repo = SQLConversationRepository(database)
    conversation = repo.create("alice")
    repo.save(conversation, {"recent_turns": [{"role": "user", "text": "pizza"}]})
    loaded = repo.load(conversation.id, "alice")
    assert loaded.revision == 1 and loaded.snapshot["recent_turns"][0]["text"] == "pizza"
    with pytest.raises(ConversationNotFound):
        repo.load(conversation.id, "bob")
    with pytest.raises(ConversationConflict):
        repo.save(conversation, {"stale": True})


def test_journal_fences_leases_and_replays_completed_turns(database):
    repo, journal = SQLConversationRepository(database), TurnJournal(database)
    owner = str(uuid4())
    conversation = repo.create(owner).id
    request = str(uuid4())
    old = journal.begin(owner, conversation, request, "add two")
    with pytest.raises(TurnPending):
        journal.begin(owner, conversation, request, "add two")
    with pytest.raises(ConversationConflict):
        journal.begin(owner, conversation, request, "different message")
    journal.release(old)
    current = journal.begin(owner, conversation, request, "add two")
    with pytest.raises(TurnPending):
        journal.stage(old, {"command": "must not execute"})
    plan = {"command": {"operation": "add", "cart_revision": 3}, "request_key": "immutable"}
    journal.stage(current, plan)
    journal.applying(current)
    journal.applied(current, {"cart": {"revision": 4}})
    response = {"text": "done"}
    assert journal.finish(current, response, {"recent_turns": ["x"]}) == response
    replay = journal.begin(owner, conversation, request, "add two")
    assert replay.response == response and replay.plan == plan
    assert repo.load(conversation, owner).snapshot == {"recent_turns": ["x"]}
    with pytest.raises(ConversationNotFound):
        journal.begin(str(uuid4()), conversation, str(uuid4()), "not my conversation")


def test_concurrent_turns_on_one_conversation_allow_exactly_one(database):
    repo, journal = SQLConversationRepository(database), TurnJournal(database)
    owner = str(uuid4())
    conversation = repo.create(owner).id
    outcomes, barrier = [], threading.Barrier(6)

    def attempt():
        barrier.wait()
        try:
            journal.begin(owner, conversation, str(uuid4()), "hi")
            outcomes.append("started")
        except ConversationConflict:
            outcomes.append("conflict")

    threads = [threading.Thread(target=attempt) for _ in range(6)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(outcomes) == ["conflict"] * 5 + ["started"]


def test_retention_purges_only_inactive_finished_conversations(database):
    repo, journal = SQLConversationRepository(database), TurnJournal(database)
    old_done, old_pending, fresh = (repo.create("alice") for _ in range(3))
    record = journal.begin("alice", old_done.id, str(uuid4()), "hello")
    journal.finish(record, {"text": "hi"}, {})
    journal.begin("alice", old_pending.id, str(uuid4()), "cart edit in flight")
    future = time.time() + 40 * 86400
    repo.save(repo.load(fresh.id, "alice"), {"touched": True})
    with database.transaction() as tx:   # "fresh" was active just before the purge time
        tx.execute("UPDATE {conversations} SET updated_at = ? WHERE id = ?", (future - 1, fresh.id))
    assert repo.purge_inactive(30, now=future) == 1
    with pytest.raises(ConversationNotFound):
        repo.load(old_done.id, "alice")
    repo.load(old_pending.id, "alice")   # unfinished turn is kept for reconciliation
    repo.load(fresh.id, "alice")
    with database.transaction() as tx:
        assert tx.execute("SELECT count(*) FROM {chat_turns} WHERE conversation_id = ?",
                          (old_done.id,)).fetchone()[0] == 0


def test_delete_user_data_removes_only_that_user(database):
    repo, journal = SQLConversationRepository(database), TurnJournal(database)
    mine, theirs = repo.create("alice"), repo.create("bob")
    journal.finish(journal.begin("alice", mine.id, str(uuid4()), "hi"), {"text": "x"}, {})
    assert repo.delete_user_data("alice") == 1
    with pytest.raises(ConversationNotFound):
        repo.load(mine.id, "alice")
    assert repo.load(theirs.id, "bob").user_id == "bob"
    with database.transaction() as tx:
        assert tx.execute("SELECT count(*) FROM {chat_turns} WHERE owner = ?", ("alice",)).fetchone()[0] == 0


def test_existing_sqlite_journal_is_upgraded_without_losing_data(tmp_path):
    path = tmp_path / "old.sqlite3"
    with sqlite3.connect(path) as db:   # schema from before retention columns existed
        db.execute("""CREATE TABLE conversations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL)""")
        db.execute("""CREATE TABLE chat_turns (owner TEXT NOT NULL, conversation_id TEXT NOT NULL,
            request_id TEXT NOT NULL, message_hash TEXT NOT NULL, status TEXT NOT NULL, lease TEXT NOT NULL,
            lease_until REAL NOT NULL, context TEXT NOT NULL, plan TEXT, result TEXT, response TEXT,
            PRIMARY KEY(owner, conversation_id, request_id))""")
        db.execute("INSERT INTO conversations VALUES ('c1', 'alice', 3, '{\"kept\": true}')")
        db.execute("""INSERT INTO chat_turns VALUES ('alice','c1','r1','h','completed','l',0,'{}',
            NULL,NULL,'{"text":"old reply"}')""")
    database = SQLiteDatabase(path)
    loaded = SQLConversationRepository(database).load("c1", "alice")
    assert loaded.revision == 3 and loaded.snapshot == {"kept": True}
    with database.transaction() as tx:
        assert tx.execute("SELECT response FROM chat_turns WHERE request_id='r1'").fetchone()[0] \
            == '{"text":"old reply"}'
        assert tx.execute("SELECT updated_at FROM conversations").fetchone()[0] is not None
    # Upgraded rows start their retention clock now, so nothing is purged yet.
    assert SQLConversationRepository(database).purge_inactive(30) == 0
