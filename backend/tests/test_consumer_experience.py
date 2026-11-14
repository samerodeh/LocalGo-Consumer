from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app.main import app
from app.routers import consumer as api

ORDER = "11111111-1111-4111-8111-111111111111"
MERCHANT = {
    "id": "al-taib",
    "name": "Al Taib",
    "pickup_enabled": True,
    "delivery_fee_cents": 500,
    "latitude": None,
    "longitude": None,
}
BASE = {
    "merchantId": "al-taib",
    "items": [{"productId": "create-your-bowl-500-g", "quantity": 2}],
    "tipCents": 225,
}
PROMO = {
    "active": True,
    "kind": "percent",
    "amount": 20,
    "minimum_cents": 1000,
    "max_discount_cents": None,
    "merchant_id": None,
    "mode": None,
    "usage_limit": 1,
    "per_customer_limit": 1,
    "redeemed_count": 0,
}


@pytest.fixture(autouse=True)
def session(monkeypatch):
    monkeypatch.setattr(
        api, "require_user", AsyncMock(return_value=("token", "customer"))
    )
    monkeypatch.setattr(api.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(api.config, "SUPABASE_SERVICE_ROLE_KEY", "fixture")
    monkeypatch.setattr(api.config, "ALLOW_DEMO_ORDERS", True)
    monkeypatch.setattr(api, "merchant_by_id", AsyncMock(return_value=MERCHANT))


def test_quote_uses_server_prices_not_client_fields():
    r = TestClient(app).post("/consumer/quote", json=BASE)
    assert r.status_code == 200
    assert r.json() == {
        "subtotalCents": 2500,
        "deliveryFeeCents": 500,
        "tipCents": 225,
        "discountCents": 0,
        "totalCents": 3225,
        "promoCode": None,
        "currency": "CAD",
    }
    assert (
        TestClient(app)
        .post("/consumer/quote", json={**BASE, "totalCents": 1})
        .status_code
        == 422
    )


@pytest.mark.parametrize(
    "items",
    [
        [{"productId": "not-on-menu", "quantity": 1}],
        [{"productId": "create-your-bowl-500-g", "quantity": 0}],
        [
            {
                "productId": "create-your-bowl-500-g",
                "quantity": 1,
                "selections": [{"groupId": "made-up", "choiceNames": ["Free"]}],
            }
        ],
    ],
)
def test_tampered_lines_fail(items):
    assert (
        TestClient(app)
        .post("/consumer/quote", json={**BASE, "items": items})
        .status_code
        == 422
    )


def test_pickup_has_no_driver_tip_or_delivery_fee():
    r = TestClient(app).post("/consumer/quote", json={**BASE, "mode": "pickup"})
    assert r.json()["deliveryFeeCents"] == 0
    assert r.json()["tipCents"] == 0
    assert r.json()["totalCents"] == 2500


def test_store_must_opt_into_pickup(monkeypatch):
    monkeypatch.setattr(
        api,
        "merchant_by_id",
        AsyncMock(return_value={**MERCHANT, "pickup_enabled": False}),
    )
    assert (
        TestClient(app)
        .post("/consumer/quote", json={**BASE, "mode": "pickup"})
        .status_code
        == 422
    )


def test_expired_promo_and_wrong_store_fail():
    with pytest.raises(HTTPException):
        api.promotion_discount(
            {
                **PROMO,
                "expires_at": (
                    datetime.now(timezone.utc) - timedelta(seconds=1)
                ).isoformat(),
            },
            2500,
            "delivery",
            "al-taib",
        )
    with pytest.raises(HTTPException):
        api.promotion_discount(
            {**PROMO, "merchant_id": "other-store"}, 2500, "delivery", "al-taib"
        )
    assert (
        api.promotion_discount(
            {**PROMO, "kind": "fixed", "amount": 999999}, 2500, "delivery", "al-taib"
        )
        == 2500
    )
    assert (
        api.promotion_discount(
            {**PROMO, "max_discount_cents": 100}, 2500, "delivery", "al-taib"
        )
        == 100
    )


def test_promotion_limit_is_checked(monkeypatch):
    monkeypatch.setattr(
        api, "_get", AsyncMock(side_effect=[[{**PROMO, "redeemed_count": 1}], []])
    )
    assert (
        TestClient(app)
        .post("/consumer/quote", json={**BASE, "promoCode": "LOCAL20"})
        .status_code
        == 422
    )


def test_total_change_prevents_insert(monkeypatch):
    monkeypatch.setattr(api, "_get", AsyncMock(return_value=[]))
    post = AsyncMock()
    monkeypatch.setattr(api.client, "post", post)
    r = TestClient(app).post(
        "/consumer/checkout",
        json={**BASE, "mode": "pickup", "id": ORDER, "expectedTotalCents": 1},
    )
    assert r.status_code == 409
    post.assert_not_awaited()


def test_release_guard_preserved(monkeypatch):
    monkeypatch.setattr(api.config, "ALLOW_DEMO_ORDERS", False)
    r = TestClient(app).post(
        "/consumer/checkout", json={**BASE, "id": ORDER, "expectedTotalCents": 3225}
    )
    assert r.status_code == 503


def test_pickup_checkout_needs_no_delivery_address(monkeypatch):
    monkeypatch.setattr(api, "_get", AsyncMock(return_value=[]))
    post = AsyncMock(
        return_value=httpx.Response(
            200, json={"order_number": "#LG-TEST", "quote": {"totalCents": 2500}}
        )
    )
    monkeypatch.setattr(api.client, "post", post)
    r = TestClient(app).post(
        "/consumer/checkout",
        json={**BASE, "mode": "pickup", "id": ORDER, "expectedTotalCents": 2500},
    )
    assert r.status_code == 200
    row = post.await_args.kwargs["json"]["p_order"]
    assert row["address"] is None and row["mode"] == "pickup"
    assert "consumer_checkout" in post.await_args.args[0]


def test_idempotent_retry_uses_original_receipt(monkeypatch):
    monkeypatch.setattr(
        api,
        "_get",
        AsyncMock(
            return_value=[{"order_number": "#LG-TEST", "quote": {"totalCents": 2500}}]
        ),
    )
    quote = AsyncMock()
    monkeypatch.setattr(api, "quote_for", quote)
    assert (
        TestClient(app)
        .post("/consumer/checkout", json={**BASE, "id": ORDER, "expectedTotalCents": 1})
        .status_code
        == 200
    )
    quote.assert_not_awaited()


def test_customer_cannot_read_another_customers_order(monkeypatch):
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(api, "_get", fetch)
    assert TestClient(app).get(f"/consumer/orders/{ORDER}").status_code == 404
    assert fetch.await_args.args[1]["customer_id"] == "eq.customer"


def test_stale_courier_locations_are_rejected(monkeypatch):
    monkeypatch.setattr(
        api, "_require_driver", AsyncMock(return_value=("token", "driver"))
    )
    assert (
        TestClient(app)
        .post(
            f"/consumer/orders/{ORDER}/location",
            json={
                "latitude": 45.49,
                "longitude": -73.57,
                "accuracy": 10,
                "recordedAt": (
                    datetime.now(timezone.utc) - timedelta(minutes=3)
                ).isoformat(),
            },
        )
        .status_code
        == 422
    )


def test_location_requires_assigned_active_driver(monkeypatch):
    monkeypatch.setattr(
        api, "_require_driver", AsyncMock(return_value=("token", "driver"))
    )
    fetch = AsyncMock(return_value=[])
    monkeypatch.setattr(api, "_get", fetch)
    assert (
        TestClient(app)
        .post(
            f"/consumer/orders/{ORDER}/location",
            json={
                "latitude": 45.49,
                "longitude": -73.57,
                "accuracy": 10,
                "recordedAt": datetime.now(timezone.utc).isoformat(),
            },
        )
        .status_code
        == 403
    )
    assert fetch.await_args.args[1]["accepted_by"] == "eq.driver"


def test_pickup_requires_staff_access(monkeypatch):
    monkeypatch.setattr(api, "_get", AsyncMock(return_value=[]))
    assert (
        TestClient(app)
        .post(f"/consumer/merchant/orders/{ORDER}/status", json={"status": "ready"})
        .status_code
        == 403
    )


def test_review_requires_completed_order(monkeypatch):
    monkeypatch.setattr(
        api, "receipt_for", AsyncMock(return_value={"merchant_id": "al-taib"})
    )
    monkeypatch.setattr(
        api, "public_order", AsyncMock(return_value={"status": "accepted"})
    )
    assert (
        TestClient(app)
        .post(f"/consumer/orders/{ORDER}/review", json={"rating": 5})
        .status_code
        == 409
    )
