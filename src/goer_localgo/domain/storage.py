"""Storage backends for Goer conversations and the fenced turn journal.

* SQLite (default): one local file, for development and single-process hosting.
  ``BEGIN IMMEDIATE`` serializes writers across processes on that machine.
* Postgres (``GOER_DATABASE_URL``): shared storage for multi-host deployments.
  Row locks (``FOR UPDATE``) replace SQLite's database lock. Tables live in a
  dedicated ``goer`` schema so Supabase does not expose them through its public
  REST API, and row-level security is enabled with no policies as a backstop.

SQL is written once with ``?`` placeholders and ``{table}`` names; each backend
translates. Never store credentials in these tables.
"""
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Protocol

TABLES = ("conversations", "chat_turns", "rate_limits")


class Transaction(Protocol):
    def execute(self, sql: str, params: tuple = ()) -> Any: ...


class Database(Protocol):
    dialect: str
    lock: str
    def table(self, name: str) -> str: ...
    def transaction(self, immediate: bool = False) -> Any: ...


def _format(sql: str, db: "Database") -> str:
    return sql.format(**{name: db.table(name) for name in TABLES})


class SQLiteDatabase:
    dialect = "sqlite"
    lock = ""  # BEGIN IMMEDIATE already holds the database write lock.

    def __init__(self, path: Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.transaction() as tx:
            tx.execute("""CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 0, snapshot TEXT NOT NULL, updated_at REAL)""")
            tx.execute("""CREATE TABLE IF NOT EXISTS chat_turns (
                owner TEXT NOT NULL, conversation_id TEXT NOT NULL, request_id TEXT NOT NULL,
                message_hash TEXT NOT NULL, status TEXT NOT NULL, lease TEXT NOT NULL,
                lease_until REAL NOT NULL, context TEXT NOT NULL, plan TEXT, result TEXT, response TEXT,
                created_at REAL, PRIMARY KEY(owner, conversation_id, request_id))""")
            # Upgrade databases created before retention timestamps existed. Old
            # rows start their retention clock now rather than being purged.
            for table, column in (("conversations", "updated_at"), ("chat_turns", "created_at")):
                columns = {row[1] for row in tx.execute(f"PRAGMA table_info({table})").fetchall()}
                if column not in columns:
                    tx.execute(f"ALTER TABLE {table} ADD COLUMN {column} REAL")
                tx.execute(f"UPDATE {table} SET {column} = ? WHERE {column} IS NULL", (time.time(),))
            tx.execute("""CREATE UNIQUE INDEX IF NOT EXISTS one_pending_turn
                ON chat_turns(owner, conversation_id) WHERE status != 'completed'""")
            tx.execute("CREATE INDEX IF NOT EXISTS conversations_updated ON conversations(updated_at)")

    def table(self, name: str) -> str:
        return name

    @contextmanager
    def transaction(self, immediate: bool = False) -> Iterator["_Tx"]:
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                if immediate:
                    db.execute("BEGIN IMMEDIATE")
                yield _Tx(db, self, postgres=False)
        finally:
            # A connection's own context manager commits but does not close it.
            db.close()


class PostgresDatabase:
    dialect = "postgres"
    lock = " FOR UPDATE"

    def __init__(self, url: str, *, min_size: int = 1, max_size: int = 10):
        from psycopg_pool import ConnectionPool

        self.pool = ConnectionPool(url, min_size=min_size, max_size=max_size, open=True,
                                   kwargs={"autocommit": False}, name="goer")
        if os.environ.get("GOER_DB_AUTO_MIGRATE", "true").lower() == "true":
            self.migrate()

    def migrate(self) -> None:
        with self.transaction() as tx:
            for statement in POSTGRES_SCHEMA:
                tx.execute(statement)

    def table(self, name: str) -> str:
        return f"goer.{name}"

    @contextmanager
    def transaction(self, immediate: bool = False) -> Iterator["_Tx"]:
        with self.pool.connection() as conn:
            with conn.transaction():
                yield _Tx(conn, self, postgres=True)

    def close(self) -> None:
        self.pool.close()


POSTGRES_SCHEMA = (
    "CREATE SCHEMA IF NOT EXISTS goer",
    """CREATE TABLE IF NOT EXISTS goer.conversations (
        id text PRIMARY KEY, user_id text NOT NULL, revision integer NOT NULL DEFAULT 0,
        snapshot text NOT NULL, updated_at double precision NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS goer.chat_turns (
        owner text NOT NULL, conversation_id text NOT NULL, request_id text NOT NULL,
        message_hash text NOT NULL, status text NOT NULL, lease text NOT NULL,
        lease_until double precision NOT NULL, context text NOT NULL, plan text, result text,
        response text, created_at double precision NOT NULL,
        PRIMARY KEY (owner, conversation_id, request_id))""",
    """CREATE UNIQUE INDEX IF NOT EXISTS one_pending_turn
        ON goer.chat_turns (owner, conversation_id) WHERE status <> 'completed'""",
    "CREATE INDEX IF NOT EXISTS conversations_updated ON goer.conversations (updated_at)",
    "CREATE INDEX IF NOT EXISTS conversations_user ON goer.conversations (user_id)",
    """CREATE TABLE IF NOT EXISTS goer.rate_limits (
        key text PRIMARY KEY, events double precision[] NOT NULL,
        expires_at double precision NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS rate_limits_expiry ON goer.rate_limits (expires_at)",
    # Backstop: no policies means no access for API roles even if the schema is
    # ever exposed. The server connects as the owning role, which bypasses RLS.
    "ALTER TABLE goer.conversations ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE goer.chat_turns ENABLE ROW LEVEL SECURITY",
    "ALTER TABLE goer.rate_limits ENABLE ROW LEVEL SECURITY",
    "REVOKE ALL ON SCHEMA goer FROM PUBLIC",
)


class _Tx:
    def __init__(self, connection: Any, db: Database, *, postgres: bool):
        self._connection = connection
        self._db = db
        self._postgres = postgres

    def execute(self, sql: str, params: tuple = ()) -> Any:
        sql = _format(sql, self._db)
        if self._postgres:
            sql = sql.replace("?", "%s")
        return self._connection.execute(sql, params)


_databases: dict[str, Database] = {}
_lock = threading.Lock()


def conversation_db_path() -> Path:
    return Path(os.environ.get(
        "GOER_CONVERSATION_DB", str(Path.home() / ".localgo" / "goer" / "conversations.sqlite3")
    ))


def get_database() -> Database:
    """Postgres when GOER_DATABASE_URL is set, otherwise the local SQLite file."""
    url = os.environ.get("GOER_DATABASE_URL", "").strip()
    key = url or f"sqlite:{conversation_db_path()}"
    with _lock:
        database = _databases.get(key)
        if database is None:
            database = PostgresDatabase(url) if url else SQLiteDatabase(conversation_db_path())
            _databases[key] = database
        return database
