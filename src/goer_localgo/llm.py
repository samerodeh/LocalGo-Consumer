"""Shared model clients.

Building a CrewAI ``LLM`` creates new OpenAI HTTP clients, and on Windows each
one reloads the system certificate store (~1.4 s). Turns therefore reuse one
base LLM per configuration. Each caller gets a shallow copy: the thread-safe
OpenAI clients are shared, while per-run attributes CrewAI sets on the LLM
(such as stop words) stay private to that turn.
"""
import copy
import os
import threading

from crewai import LLM

_lock = threading.Lock()
_base: dict[tuple, LLM] = {}


def get_llm(*, temperature: float | None = None, timeout: float | None = None) -> LLM:
    model = os.environ.get("MODEL", "openai/gpt-4.1-mini")
    key = (model, temperature, timeout)
    with _lock:
        base = _base.get(key)
        if base is None:
            options = {k: v for k, v in (("temperature", temperature), ("timeout", timeout)) if v is not None}
            base = _base[key] = LLM(model=model, **options)
    return copy.copy(base)


def warm_up() -> None:
    """Create the default clients at startup so the first turn is not slower."""
    get_llm()
    get_llm(temperature=0, timeout=20)
    # First crew construction also pays one-time CrewAI setup; do it now.
    from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew
    from goer_localgo.flow.goer_flow import GoerFlow
    DiscoveryCrew().crew()
    GoerFlow()
