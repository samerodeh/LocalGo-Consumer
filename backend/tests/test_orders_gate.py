"""The money gate on POST /orders.

An order must not exist without a matching succeeded charge, and one charge
must not be replayable into many orders.
"""

import uuid

import pytest
import stripe
from fastapi import HTTPException

from app import config
from app.routers import orders

from conftest import FakeIntent


class Body:
    """Minimal stand-in for PlaceOrderBody — _verify_payment only reads this."""

    def __init__(self, payment_intent_id="pi_stub"):
        self.payment_intent_id = payment_intent_id


ORDER_ID = "e0e1c0de-0000-4000-8000-000000000042"


def test_demo_mode_skips_the_gate(monkeypatch):
    # No Stripe configured: returns None so the caller falls back to the body
    # total. This is what keeps offline demo mode working.
    monkeypatch.setattr(config, "STRIPE_CONFIGURED", False)
    assert orders._verify_payment(ORDER_ID, Body()) is None


def test_missing_intent_is_rejected(stripe_on):
    with pytest.raises(HTTPException) as e:
        orders._verify_payment(ORDER_ID, Body(payment_intent_id=None))
    assert e.value.status_code == 402


def test_unsucceeded_intent_is_rejected(stripe_on, monkeypatch):
    monkeypatch.setattr(
        stripe.PaymentIntent, "retrieve",
        staticmethod(lambda pid: FakeIntent(status="requires_payment_method",
                                            amount=4108, order_id=ORDER_ID)),
    )
    with pytest.raises(HTTPException) as e:
        orders._verify_payment(ORDER_ID, Body())
    assert e.value.status_code == 402


def test_intent_for_a_different_order_is_rejected(stripe_on, monkeypatch):
    """Replay protection: one succeeded charge must unlock exactly one order."""
    monkeypatch.setattr(
        stripe.PaymentIntent, "retrieve",
        staticmethod(lambda pid: FakeIntent(status="succeeded", amount=4108,
                                            order_id="some-other-order")),
    )
    with pytest.raises(HTTPException) as e:
        orders._verify_payment(ORDER_ID, Body())
    assert e.value.status_code == 402
    assert "different order" in e.value.detail


def test_succeeded_intent_returns_the_charged_amount(stripe_on, monkeypatch):
    monkeypatch.setattr(
        stripe.PaymentIntent, "retrieve",
        staticmethod(lambda pid: FakeIntent(status="succeeded", amount=4108, order_id=ORDER_ID)),
    )
    # Dollars, taken from Stripe — never from the request body.
    assert orders._verify_payment(ORDER_ID, Body()) == 41.08


def test_metadata_may_be_a_stripeobject_not_a_dict(stripe_on, monkeypatch):
    """Regression: the real API returns a StripeObject for `metadata`, which has
    no .get(). A dict-based stub hid that once and it 500'd on the first real
    payment. Anything dict-like but not a dict must still work."""

    class StripeObjectish:
        def __init__(self, data):
            self._data = data

        def __getattr__(self, k):
            # Mimics StripeObject: attribute access works, .get() does not.
            try:
                return self._data[k]
            except KeyError as e:
                raise AttributeError(k) from e

        def to_dict(self):
            return dict(self._data)

    intent = FakeIntent(status="succeeded", amount=4108)
    intent.metadata = StripeObjectish({"order_id": ORDER_ID})
    monkeypatch.setattr(stripe.PaymentIntent, "retrieve", staticmethod(lambda pid: intent))

    assert orders._verify_payment(ORDER_ID, Body()) == 41.08


def test_stripe_lookup_failure_is_rejected_not_ignored(stripe_on, monkeypatch):
    def boom(pid):
        raise stripe.StripeError("api down")

    monkeypatch.setattr(stripe.PaymentIntent, "retrieve", staticmethod(boom))
    with pytest.raises(HTTPException) as e:
        orders._verify_payment(ORDER_ID, Body())
    # Fail closed: an unverifiable payment must never let an order through.
    assert e.value.status_code == 402


def test_endpoint_rejects_unpaid_order(client, stripe_on, supabase_on):
    r = client.post("/orders", json={
        "id": str(uuid.uuid4()),
        "restaurant_name": "Al Taib",
        "dropoff_address": "2125 Guy St, Montreal",
        "latitude": 45.49, "longitude": -73.58,
        "subtotal": 10, "delivery_fee": 5, "tip": 0, "total": 15,
        "items": [{"name": "Cheese Pizza Slice", "quantity": 2}],
    })
    assert r.status_code == 402


@pytest.mark.parametrize("lat, lng, label", [
    (0, 0, "the never-geocoded sentinel"),
    (91, 0, "latitude out of range"),
    (0, 181, "longitude out of range"),
])
def test_delivery_location_gate_runs_before_payment(client, stripe_on, supabase_on, lat, lng, label):
    # 422 (bad location), not 402 (no payment) — location is checked first, so
    # we never charge for an undeliverable order.
    r = client.post("/orders", json={
        "id": str(uuid.uuid4()),
        "restaurant_name": "Al Taib",
        "dropoff_address": "2125 Guy St, Montreal",
        "latitude": lat, "longitude": lng,
        "subtotal": 10, "delivery_fee": 5, "tip": 0, "total": 15,
        "items": [{"name": "Cheese Pizza Slice", "quantity": 2}],
    })
    assert r.status_code == 422, label
