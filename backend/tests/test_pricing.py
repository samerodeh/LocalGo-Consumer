"""Server-side pricing — the module that decides what a customer is charged.

Runs against the real committed app/menu_prices.json, so these also catch the
menu drifting out of sync with src/data/menu.ts.
"""

import pytest

from app import pricing


def test_menu_loads_and_covers_both_restaurants():
    assert pricing.MENU_LOADED, "menu_prices.json missing or unreadable — checkout would 422"
    assert "cheese-pizza-slice" in pricing.PRICES, "Al Taib items missing"
    assert "ck-hummus" in pricing.PRICES, (
        "Chateau Kabab items missing — it has hasMenu: true, so its orders must be priceable"
    )


def test_float_prices_convert_to_exact_cents():
    # 6.75 * 100 is 674.99999... in binary float. int() would give 674 and
    # undercharge by a cent on every one of these.
    assert pricing.PRICES["all-dressed-pizza-slice"] == 675
    assert pricing.PRICES["cheese-pizza-slice"] == 550
    assert pricing.PRICES["tuna-pizza"] == 2208


def test_totals_match_the_apps_rules():
    # subtotal + $5 flat delivery + tip, mirroring src/store/cartStore.ts
    q = pricing.quote([("cheese-pizza-slice", 2), ("tuna-pizza", 1)], tip_cents=300)
    assert q.subtotal_cents == 550 * 2 + 2208
    assert q.delivery_fee_cents == pricing.DELIVERY_FEE_CENTS == 500
    assert q.tip_cents == 300
    assert q.total_cents == q.subtotal_cents + 500 + 300 == 4108
    assert q.currency == "cad"


def test_second_restaurant_prices():
    q = pricing.quote([("ck-hummus", 1), ("ck-mixed-kabab", 1)], tip_cents=0)
    assert q.total_cents == q.subtotal_cents + 500
    assert {line.item_id for line in q.lines} == {"ck-hummus", "ck-mixed-kabab"}


def test_zero_tip_is_allowed():
    q = pricing.quote([("cheese-pizza-slice", 1)], tip_cents=0)
    assert q.tip_cents == 0
    assert q.total_cents == 550 + 500


def test_metadata_is_all_strings_for_stripe():
    # Stripe rejects non-string metadata values.
    meta = pricing.quote([("cheese-pizza-slice", 2)], tip_cents=0).as_metadata()
    assert all(isinstance(v, str) for v in meta.values())
    assert meta["total_cents"] == "1600"
    assert meta["item_count"] == "2"


@pytest.mark.parametrize(
    "items, tip, reason",
    [
        ([("free-lunch", 1)], 0, "unknown item must be refused, never guessed"),
        ([("cheese-pizza-slice", 0)], 0, "zero quantity"),
        ([("cheese-pizza-slice", -1)], 0, "negative quantity"),
        ([("cheese-pizza-slice", 100)], 0, "quantity over MAX_QUANTITY"),
        ([("cheese-pizza-slice", 1), ("cheese-pizza-slice", 1)], 0, "duplicate cart line"),
        ([], 0, "empty cart"),
        ([("cheese-pizza-slice", 1)], -100, "negative tip"),
        ([("cheese-pizza-slice", 1)], 999_999, "tip over MAX_TIP_CENTS"),
    ],
)
def test_unpriceable_carts_raise(items, tip, reason):
    with pytest.raises(pricing.PricingError):
        pricing.quote(items, tip_cents=tip)


def test_absurd_total_is_refused():
    # 50 distinct lines at max quantity would sail past MAX_TOTAL_CENTS.
    ids = list(pricing.PRICES)[: pricing.MAX_LINES]
    with pytest.raises(pricing.PricingError):
        pricing.quote([(i, pricing.MAX_QUANTITY) for i in ids], tip_cents=0)


def test_fails_closed_when_menu_is_unavailable(monkeypatch):
    # If the price list can't be read, pricing must refuse outright rather than
    # fall back to anything client-supplied.
    monkeypatch.setattr(pricing, "MENU_LOADED", False)
    with pytest.raises(pricing.PricingError):
        pricing.quote([("cheese-pizza-slice", 1)], tip_cents=0)
