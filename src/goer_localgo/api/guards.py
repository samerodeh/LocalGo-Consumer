"""Deterministic pre-checks that run before a message reaches the model.

* Payment-card data typed into chat is refused before it is stored, traced or
  sent to the model. Card entry belongs only in Stripe's payment form.
* Per-principal turn rate limits cap abuse and model cost.

The rate limiter is in-process: correct for one server process. A multi-host
deployment needs a shared store (e.g. Redis) behind the same interface.
"""
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


turn_limiter = RateLimiter(((20, 60), (200, 3600)))
