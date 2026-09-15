"""POST /payments/intent — the endpoint that decides how much to charge.

The property under test throughout: the client cannot influence the amount.
"""

import uuid

import stripe

from conftest import FakeIntent


def _body(order_id=None, **extra):
    return {
        "order_id": order_id or str(uuid.uuid4()),
        "items": [{"id": "cheese-pizza-slice", "quantity": 2}],
        "tip_cents": 0,
        **extra,
    }


def test_refuses_when_stripe_not_configured(client):
    # Fails closed: no keys means no intent, not a free order.
    r = client.post("/payments/intent", json=_body())
    assert r.status_code == 503


def test_charges_the_server_computed_amount(client, stripe_on, monkeypatch):
    captured = {}

    def fake_create(**kw):
        captured.update(kw)
        return FakeIntent(amount=kw["amount"])

    monkeypatch.setattr(stripe.PaymentIntent, "create", staticmethod(fake_create))

    r = client.post("/payments/intent", json=_body())
    assert r.status_code == 200
    # 2 x 5.50 + 5.00 delivery
    assert captured["amount"] == 1600
    assert captured["currency"] == "cad"
    assert r.json()["total_cents"] == 1600


def test_client_supplied_totals_are_ignored(client, stripe_on, monkeypatch):
    """The core anti-tamper property: a modified client cannot set its price."""
    captured = {}
    monkeypatch.setattr(
        stripe.PaymentIntent, "create",
        staticmethod(lambda **kw: (captured.update(kw), FakeIntent(amount=kw["amount"]))[1]),
    )

    r = client.post("/payments/intent", json=_body(
        total_cents=1, total=0.01, subtotal=0.01, amount=1,
    ))
    assert r.status_code == 200
    assert captured["amount"] == 1600, "client-sent price leaked into the charge"


def test_order_id_is_the_idempotency_key(client, stripe_on, monkeypatch):
    # Same order id must reuse one intent rather than create a second charge.
    captured = {}
    monkeypatch.setattr(
        stripe.PaymentIntent, "create",
        staticmethod(lambda **kw: (captured.update(kw), FakeIntent(amount=kw["amount"]))[1]),
    )
    oid = str(uuid.uuid4())
    client.post("/payments/intent", json=_body(order_id=oid))
    assert captured["idempotency_key"] == f"localgo-order-{oid}"
    assert captured["metadata"]["order_id"] == oid


def test_unknown_item_is_refused(client, stripe_on, monkeypatch):
    monkeypatch.setattr(
        stripe.PaymentIntent, "create",
        staticmethod(lambda **kw: FakeIntent(amount=kw["amount"])),
    )
    r = client.post("/payments/intent", json={
        "order_id": str(uuid.uuid4()),
        "items": [{"id": "free-lunch", "quantity": 1}],
    })
    assert r.status_code == 422
    assert "menu" in r.json()["detail"].lower()


def test_non_uuid_order_id_rejected(client, stripe_on):
    r = client.post("/payments/intent", json=_body(order_id="not-a-uuid"))
    assert r.status_code == 422


def test_amount_mismatch_on_idempotent_replay_is_refused(client, stripe_on, monkeypatch):
    """If the cart changed between attempts, Stripe returns the FIRST intent at
    the old amount. Charging that would bill a total the user never saw."""
    monkeypatch.setattr(
        stripe.PaymentIntent, "create",
        staticmethod(lambda **kw: FakeIntent(amount=9999)),  # stale amount
    )
    r = client.post("/payments/intent", json=_body())
    assert r.status_code == 409


def test_stripe_failure_becomes_502_not_a_crash(client, stripe_on, monkeypatch):
    def boom(**kw):
        raise stripe.StripeError("network down")

    monkeypatch.setattr(stripe.PaymentIntent, "create", staticmethod(boom))
    r = client.post("/payments/intent", json=_body())
    assert r.status_code == 502
    # The raw Stripe error must not leak to the client.
    assert "network down" not in r.json()["detail"]


def test_publishable_key_returned_secret_never_is(client, stripe_on, monkeypatch):
    monkeypatch.setattr(
        stripe.PaymentIntent, "create",
        staticmethod(lambda **kw: FakeIntent(amount=kw["amount"])),
    )
    body = client.post("/payments/intent", json=_body()).json()
    assert body["publishable_key"] == "pk_test_stub"
    assert "sk_test_stub" not in str(body), "secret key leaked in the response"
