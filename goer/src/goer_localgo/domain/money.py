"""Deterministic money helpers. Amounts are always integer cents."""

DEFAULT_CURRENCY = "CAD"

_SYMBOLS = {"CAD": "$"}


def normalize_currency(code: str) -> str:
    normalized = code.strip().upper()
    if len(normalized) != 3 or not normalized.isalpha():
        raise ValueError(f"Invalid ISO 4217 currency code: {code!r}")
    return normalized


def format_cents(cents: int, currency: str = DEFAULT_CURRENCY) -> str:
    """Format integer cents for display, e.g. 1299 -> "$12.99"."""
    if isinstance(cents, bool) or not isinstance(cents, int):
        raise TypeError("Money amounts must be integer cents.")

    code = normalize_currency(currency)
    try:
        symbol = _SYMBOLS[code]
    except KeyError:
        raise ValueError(f"Unsupported currency: {code}") from None

    sign = "-" if cents < 0 else ""
    dollars, remainder = divmod(abs(cents), 100)
    return f"{sign}{symbol}{dollars:,}.{remainder:02d}"
