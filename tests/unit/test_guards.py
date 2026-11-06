import pytest

from goer_localgo.api.guards import RateLimiter, contains_payment_card_data


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
