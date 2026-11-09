"""Langfuse tracing for Goer turns.

One trace per chat turn, grouped into Langfuse sessions by conversation ID.
CrewAI (crews, agents, tasks, tools) and OpenAI calls (model, tokens, cost) are
captured by OpenInference instrumentors; this module adds the turn-level root
observation, attributes and masking.

Tracing is a no-op unless LANGFUSE_PUBLIC_KEY/LANGFUSE_SECRET_KEY are set and
OTEL_SDK_DISABLED is not "true" (the offline test suite sets it).
"""
import hashlib
import logging
import os
import re
from contextlib import contextmanager
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Iterator

import goer_localgo.config  # noqa: F401  (loads .env before Langfuse reads it)

logger = logging.getLogger(__name__)

_client: Any = None
_initialized = False

_SECRET_PATTERNS = [
    (re.compile(r"Bearer\s+[A-Za-z0-9._~+/=-]+", re.I), "Bearer [REDACTED]"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+"), "[REDACTED_JWT]"),
    (re.compile(r"\b(sk|pk|rk)[-_](?:live|test|proj|lf)?[-_]?[A-Za-z0-9_-]{12,}"), "[REDACTED_KEY]"),
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[REDACTED_EMAIL]"),
    # Card-like digit runs (the API refuses these first; this is a backstop).
    (re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)"), "[REDACTED_NUMBER]"),
]


def _mask_text(text: str) -> str:
    for pattern, replacement in _SECRET_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def mask(data: Any, **_: Any) -> Any:
    """Applied by Langfuse to every input/output/metadata value before export."""
    if isinstance(data, str):
        return _mask_text(data)
    if isinstance(data, dict):
        return {key: mask(value) for key, value in data.items()}
    if isinstance(data, (list, tuple)):
        return [mask(value) for value in data]
    return data


def pseudonymous_user(user_id: str) -> str:
    """Stable per-user ID for Langfuse filtering without exporting account IDs."""
    return "u_" + hashlib.sha256(user_id.encode()).hexdigest()[:16]


def _release() -> str:
    try:
        return version("goer-localgo")
    except PackageNotFoundError:
        return "dev"


def setup_tracing():
    """Initialise Langfuse and instrumentors once. Returns the client or None."""
    global _client, _initialized
    if _initialized:
        return _client
    _initialized = True
    if os.getenv("OTEL_SDK_DISABLED", "").lower() == "true":
        return None
    if not (os.getenv("LANGFUSE_PUBLIC_KEY") and os.getenv("LANGFUSE_SECRET_KEY")):
        return None
    try:
        from langfuse import Langfuse
        from openinference.instrumentation.crewai import CrewAIInstrumentor
        from openinference.instrumentation.openai import OpenAIInstrumentor

        _client = Langfuse(
            environment=os.getenv("LANGFUSE_TRACING_ENVIRONMENT", "development"),
            release=_release(),
            mask=mask,
        )
        CrewAIInstrumentor().instrument(skip_dep_check=True)
        OpenAIInstrumentor().instrument()
    except Exception as exc:  # tracing must never break a chat turn
        logger.warning("Langfuse tracing disabled (%s)", type(exc).__name__)
        _client = None
    return _client


class TurnTrace:
    """Handle for the root observation of one turn; safe to use when disabled."""

    def __init__(self, observation: Any = None):
        self._observation = observation

    def update(self, **fields: Any) -> None:
        if self._observation is not None:
            self._observation.update(**fields)

    @contextmanager
    def step(self, name: str, as_type: str = "span", **fields: Any) -> Iterator["TurnTrace"]:
        """Nested observation for one deterministic step (routing, journal, cart write)."""
        client = _client
        if client is None or self._observation is None:
            yield TurnTrace()
            return
        with client.start_as_current_observation(name=name, as_type=as_type, **fields) as obs:
            yield TurnTrace(obs)


@contextmanager
def turn_trace(name: str, *, conversation_id: str, user_id: str, message: str,
               tags: list[str], metadata: dict[str, Any] | None = None) -> Iterator[TurnTrace]:
    """Root observation for one chat turn. Input is only the user's message."""
    client = setup_tracing()
    if client is None:
        yield TurnTrace()
        return
    from langfuse import propagate_attributes

    with propagate_attributes(
        trace_name=name,
        session_id=conversation_id,
        user_id=pseudonymous_user(user_id),
        tags=tags,
        metadata={key: str(value) for key, value in (metadata or {}).items()},
    ):
        with client.start_as_current_observation(
            name=name, as_type="agent", input={"message": message},
        ) as root:
            handle = TurnTrace(root)
            try:
                yield handle
            except Exception as exc:
                root.update(level="ERROR", status_message=type(exc).__name__)
                raise


def envelope_output(envelope: Any) -> dict[str, Any]:
    """Compact, readable trace output: reply text plus what the user was shown."""
    cards = []
    for card in envelope.cards:
        if getattr(card, "items", None) is not None:
            cards.append({"type": card.type, "total": card.total,
                          "items": [f"{i.name} ({i.display_price})" for i in card.items]})
        elif getattr(card, "product", None) is not None:
            cards.append({"type": card.type, "product": card.product.name})
        elif getattr(card, "cart", None) is not None:
            cards.append({"type": card.type, "total": card.display_total,
                          "lines": [f"{line.product_id} x{line.quantity}" for line in card.cart.lines]})
    return {"text": envelope.text, "cards": cards}


def flush() -> None:
    if _client is not None:
        _client.flush()
