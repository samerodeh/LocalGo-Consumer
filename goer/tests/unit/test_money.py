import pytest

from goer_localgo.domain.money import format_cents, normalize_currency


@pytest.mark.parametrize(
    ("cents", "expected"),
    [(0, "$0.00"), (5, "$0.05"), (550, "$5.50"), (1299, "$12.99"),
     (123456, "$1,234.56"), (-250, "-$2.50")],
)
def test_format_cents(cents, expected):
    assert format_cents(cents) == expected


def test_format_cents_accepts_lowercase_currency():
    assert format_cents(1250, "cad") == "$12.50"


@pytest.mark.parametrize("bad", [12.5, "1299", True, None])
def test_format_cents_rejects_non_integer_amounts(bad):
    with pytest.raises(TypeError):
        format_cents(bad)


def test_format_cents_rejects_unsupported_currency():
    with pytest.raises(ValueError):
        format_cents(100, "EUR")


@pytest.mark.parametrize("bad", ["", "CA", "CADX", "C4D"])
def test_normalize_currency_rejects_invalid_codes(bad):
    with pytest.raises(ValueError):
        normalize_currency(bad)
