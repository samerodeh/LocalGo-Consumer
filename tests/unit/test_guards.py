import pytest

from goer_localgo.api.guards import RateLimiter, RateLimitUnavailable, TurnRateLimiter, contains_payment_card_data


@pytest.mark.parametrize("text", [
    "my card is 4242 4242 4242 4242",
    "4242-4242-4242-4242 exp 12/30",
    "use 4000002500003155 please",
    "amex 378282246310005",
    "the cvv is 123",
    "CVC: 4567",
    "security code 999",
])
def test_payment_card_data_is_detected(text):
    assert contains_payment_card_data(text)


@pytest.mark.parametrize("text", [
    "show me pizza at Al-Taib",
    "deliver to 2285 rue saint mathieu Montreal H3H 2J7",
    "call me at 514 555 0199",
    "order 1234567890123 is late",          # 13 digits, fails the Luhn check
    "add 2 burgers and 3 drinks",
    "CONFIRM ORDER e959fdab",
])
def test_ordinary_messages_are_allowed(text):
    assert not contains_payment_card_data(text)


def test_shared_rate_limiter_never_falls_back_on_database_failure(monkeypatch):
    from goer_localgo.domain import storage

    monkeypatch.setenv("GOER_DATABASE_URL", "postgresql://unused")
    def unavailable():
        raise RuntimeError("private connection details")
    monkeypatch.setattr(storage, "get_database", unavailable)
    limiter = TurnRateLimiter(((1, 60),))
    with pytest.raises(RateLimitUnavailable, match="^Shared rate limit is unavailable.$"):
        limiter.retry_after("user:alice")
    assert not limiter._events


def test_shared_rate_limiter_selects_configured_database(monkeypatch):
    from goer_localgo.api import guards
    from goer_localgo.domain import storage

    database = object()
    monkeypatch.setenv("GOER_DATABASE_URL", "postgresql://unused")
    monkeypatch.setattr(storage, "get_database", lambda: database)
    seen = []
    def retry_after(self, key):
        seen.append((self._database, self._limits, key))
        return 17
    monkeypatch.setattr(guards.PostgresRateLimiter, "retry_after", retry_after)
    assert TurnRateLimiter(((1, 60),)).retry_after("user:alice") == 17
    assert seen == [(database, ((1, 60),), "user:alice")]


def test_rate_limiter_enforces_each_window():
    now = [0.0]
    limiter = RateLimiter(((3, 60), (5, 3600)), clock=lambda: now[0])
    assert [limiter.retry_after("u") for _ in range(3)] == [None, None, None]
    assert limiter.retry_after("u") == 61          # minute window full
    assert limiter.retry_after("other") is None    # limits are per principal
    now[0] = 61
    assert [limiter.retry_after("u") for _ in range(2)] == [None, None]
    assert limiter.retry_after("u") > 60           # hour window (5) full
    now[0] = 3601
    assert limiter.retry_after("u") is None
