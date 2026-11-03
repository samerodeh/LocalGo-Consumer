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
def offline(monkeypatch):
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

    monkeypatch.setattr(socket.socket, "connect", guarded_connect)
    # Agents resolve their default LLM at construction; a dummy key keeps that
    # from failing before tests swap in the stub.
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-not-used")
