"""Deterministic pre-checks that run before a message reaches the model.

* Payment-card data typed into chat is refused before it is stored, traced or
  sent to the model. Card entry belongs only in Stripe's payment form.
* Per-principal turn rate limits cap abuse and model cost.

With GOER_DATABASE_URL configured, admission is atomic across Postgres-backed
hosts. SQLite development keeps an in-process limiter.
"""
import hashlib
import os
import re
import threading
import time
from collections import defaultdict, deque

CARD_REFUSAL = (
    "For your security, please don't type card numbers or security codes in chat. "
    "I didn't save or process that message. Payment details are only entered in the "
    "secure Stripe payment form after you confirm checkout."
)

_CARD_CANDIDATE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")
_SECURITY_CODE = re.compile(
    r"\b(?:cvv2?|cvc2?|cid|security code)\b(?:\s*(?:is|:|=|#|-))?\s*\d{3,4}\b", re.I)


def _luhn_valid(digits: str) -> bool:
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2 == 1:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def contains_payment_card_data(text: str) -> bool:
    if _SECURITY_CODE.search(text):
        return True
    for match in _CARD_CANDIDATE.finditer(text):
        digits = re.sub(r"\D", "", match.group())
        if 13 <= len(digits) <= 19 and _luhn_valid(digits):
            return True
    return False


class RateLimiter:
    """Sliding-window limits, e.g. ((20, 60), (200, 3600)) = 20/min and 200/hour."""

    def __init__(self, limits: tuple[tuple[int, float], ...], clock=time.monotonic):
        self._limits = limits
        self._clock = clock
        self._events: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def retry_after(self, key: str) -> int | None:
        """Record one request for ``key``; return seconds to wait if over a limit."""
        now = self._clock()
        longest = max(window for _, window in self._limits)
        with self._lock:
            events = self._events[key]
            while events and now - events[0] >= longest:
                events.popleft()
            for count, window in self._limits:
                recent = [t for t in events if now - t < window]
                if len(recent) >= count:
                    return max(1, int(window - (now - recent[0])) + 1)
            events.append(now)
            return None


class RateLimitUnavailable(Exception):
    """Shared admission could not be checked; never fall back to local quotas."""


class PostgresRateLimiter:
    """Serialize admission per hashed principal, using the shared database clock."""

    def __init__(self, database, limits: tuple[tuple[int, float], ...]):
        self._database = database
        self._limits = limits

    def retry_after(self, key: str) -> int | None:
        digest = hashlib.sha256(key.encode()).hexdigest()
        longest = max(window for _, window in self._limits)
        with self._database.transaction() as tx:
            tx.execute("SET LOCAL lock_timeout = '2s'")
            tx.execute("SET LOCAL statement_timeout = '2s'")
            now = tx.execute("SELECT EXTRACT(EPOCH FROM clock_timestamp())::double precision AS now").fetchone()["now"]
            tx.execute("""INSERT INTO {rate_limits} (key, events, expires_at)
                VALUES (?, ARRAY[]::double precision[], ?) ON CONFLICT (key) DO NOTHING""",
                (digest, now + longest))
            row = tx.execute("SELECT events FROM {rate_limits} WHERE key = ? FOR UPDATE", (digest,)).fetchone()
            now = tx.execute("SELECT EXTRACT(EPOCH FROM clock_timestamp())::double precision AS now").fetchone()["now"]
            events = [event for event in row["events"] if now - event < longest]
            for count, window in self._limits:
                recent = [event for event in events if now - event < window]
                if len(recent) >= count:
                    return max(1, int(window - (now - recent[0])) + 1)
            events.append(now)
            tx.execute("UPDATE {rate_limits} SET events = ?, expires_at = ? WHERE key = ?",
                       (events, now + longest, digest))
            # Clean only after admission; never wait on another principal's lock.
            tx.execute("""DELETE FROM {rate_limits} WHERE key IN (
                SELECT key FROM {rate_limits} WHERE expires_at <= ?
                LIMIT 100 FOR UPDATE SKIP LOCKED)""", (now,))
        return None


class TurnRateLimiter(RateLimiter):
    def retry_after(self, key: str) -> int | None:
        if not os.environ.get("GOER_DATABASE_URL", "").strip():
            return super().retry_after(key)
        from goer_localgo.domain.storage import get_database

        try:
            return PostgresRateLimiter(get_database(), self._limits).retry_after(key)
        except Exception:
            raise RateLimitUnavailable("Shared rate limit is unavailable.") from None


turn_limiter = TurnRateLimiter(((20, 60), (200, 3600)))
