"""GET /orders/history — a driver's completed deliveries.

This endpoint returns customer names and home addresses, so the property that
matters is HOW it is scoped: by forwarding the driver's own token and letting
`driver_orders`' self-only RLS filter, never by the `sub` claim that
postgrest.jwt_sub decodes without verifying (see test_account.py, which proves
that claim is forgeable).
"""

import asyncio
import base64
import json

import pytest
from fastapi import HTTPException

from app import config
from app.routers import orders as orders_router
from app.routers.orders import order_history


class Res:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class FakeClient:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    async def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        return Res(200, self.payload)


def token_for(sub):
    payload = base64.urlsafe_b64encode(json.dumps({"sub": sub}).encode()).rstrip(b"=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload.decode()}.sig"


DRIVER = "d0000000-0000-4000-8000-000000000001"
TOKEN = token_for(DRIVER)

ORDER_ROW = {
    "id": "e0e1c0de-0000-4000-8000-000000000001",
    "order_number": "#LG-4821",
    "restaurant_name": "Al Taib",
    "restaurant_address": "2125 Guy St",
    "customer_name": "Aidan M",
    "dropoff_address": "88 Wellesley St",
    "item_count": 3,
    "order_total": 42.5,
    "distance_km": 3.2,
    "created_at": "2026-09-01T12:00:00+00:00",
    "items": ["2× Cheese Slice"],
    "accepted_by": DRIVER,
    "customer_id": "c0000000-0000-4000-8000-000000000009",
}


@pytest.fixture
def history_client(monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    fake = FakeClient(
        [{"order_id": ORDER_ROW["id"], "status": "delivered",
          "updated_at": "2026-09-01T13:00:00+00:00", "orders": ORDER_ROW}]
    )
    monkeypatch.setattr(orders_router, "client", fake)
    return fake


def test_history_forwards_the_drivers_own_token(history_client):
    """RLS on driver_orders is what scopes this, so the caller's token must be
    the one PostgREST sees — not the anon key, and not a jwt_sub filter."""
    asyncio.run(order_history(scope="all", authorization=f"Bearer {TOKEN}"))
    _, url, kw = history_client.calls[0]
    assert url.endswith("/driver_orders")
    assert kw["headers"]["Authorization"] == f"Bearer {TOKEN}"
    # The forgeable `sub` must not appear as a filter — RLS is the gate.
    assert "driver_id" not in kw["params"]


def test_history_returns_only_delivered_orders(history_client):
    asyncio.run(order_history(scope="all", authorization=f"Bearer {TOKEN}"))
    assert history_client.calls[0][2]["params"]["status"] == "eq.delivered"


def test_all_time_scope_sets_no_date_floor(history_client):
    asyncio.run(order_history(scope="all", authorization=f"Bearer {TOKEN}"))
    assert "updated_at" not in history_client.calls[0][2]["params"]


def test_today_scope_sets_a_date_floor(history_client):
    asyncio.run(order_history(scope="today", authorization=f"Bearer {TOKEN}"))
    assert history_client.calls[0][2]["params"]["updated_at"].startswith("gte.")


def test_history_maps_rows_for_the_driver_app(history_client):
    result = asyncio.run(order_history(scope="all", authorization=f"Bearer {TOKEN}"))
    order = result["orders"][0]
    assert order["orderNumber"] == "#LG-4821"
    assert order["status"] == "delivered"
    # deliveredAt comes from the driver's own overlay row, not the order.
    assert order["deliveredAt"] == "2026-09-01T13:00:00+00:00"


def test_history_skips_rows_whose_order_is_gone(monkeypatch):
    """A deleted order leaves the overlay row behind; emitting it would render
    a card with no restaurant, no address and no items."""
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(
        orders_router,
        "client",
        FakeClient([{"order_id": "x", "status": "delivered", "updated_at": "t", "orders": None}]),
    )
    result = asyncio.run(order_history(scope="all", authorization=f"Bearer {TOKEN}"))
    assert result["orders"] == []


def test_history_requires_a_signed_in_driver(monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    fake = FakeClient([])
    monkeypatch.setattr(orders_router, "client", fake)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(order_history(scope="all", authorization=None))
    assert exc.value.status_code == 401
    assert fake.calls == []
