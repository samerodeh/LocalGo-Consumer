import os
import socket
import sys
from pathlib import Path

# Test-only switches (AGENTS.md Rule 4). They must be set before crewai is
# imported. Never move them into .env or deployment configuration.
TESTS_DIR = Path(__file__).resolve().parent
os.environ["CREWAI_STORAGE_DIR"] = str(TESTS_DIR / ".crewai-test-storage")
os.environ["CREWAI_TESTING"] = "true"
os.environ["CREWAI_DISABLE_TELEMETRY"] = "true"
os.environ["CREWAI_TRACING_ENABLED"] = "false"
os.environ["OTEL_SDK_DISABLED"] = "true"

# Lets tests import the shared `stub_llm` helper.
sys.path.insert(0, str(TESTS_DIR))

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def offline(monkeypatch, tmp_path):
    """Fail fast if any test tries to reach a real LLM or other network host.

    Loopback stays allowed: on Windows every asyncio event loop connects an
    internal socket pair over 127.0.0.1.
    """
    real_connect = socket.socket.connect

    def guarded_connect(sock, address, *args, **kwargs):
        host = address[0] if isinstance(address, tuple) else address
        if host in ("127.0.0.1", "::1", "localhost"):
            return real_connect(sock, address, *args, **kwargs)
        raise RuntimeError(f"test tried to use the network: {address!r}")

    monkeypatch.setenv("GOER_CONVERSATION_DB", str(tmp_path / "conversations.sqlite3"))
    # Each test starts with an empty per-principal rate-limit window.
    from goer_localgo.api import guards
    guards.turn_limiter._events.clear()
    test_url = os.environ.get("GOER_TEST_DATABASE_URL")
    if test_url and os.environ.get("GOER_DATABASE_URL") == test_url:
        # The Postgres matrix shares one disposable database across test cases.
        # Reset persisted quota state just as the SQLite matrix resets memory.
        from goer_localgo.domain.storage import get_database
        with get_database().transaction() as tx:
            tx.execute("DELETE FROM {rate_limits}")
    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    # Agents resolve their default LLM at construction; a dummy key keeps that
    # from failing before tests swap in the stub.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-used")


@pytest.fixture
def use_stub(monkeypatch):
    """Use the real discovery crew and tools, with only the model replaced."""
    from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew

    original = DiscoveryCrew.crew

    def install(stub):
        def crew_with_stub(self):
            crew = original(self)
            for agent in crew.agents:
                agent.llm = stub
            return crew

        monkeypatch.setattr(DiscoveryCrew, "crew", crew_with_stub)
        return stub

    return install
