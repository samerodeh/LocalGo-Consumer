from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app import auth
from app.routers import orders, notify
from test_orders import Response, VALID_ORDER

ORDER_ID = "11111111-1111-4111-8111-111111111111"


def test_no_token_cannot_create_orders(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    post = AsyncMock()
    monkeypatch.setattr(orders.client, "post", post)
    assert TestClient(app).post("/orders", json=VALID_ORDER).status_code == 401
    post.assert_not_awaited()


def test_forged_token_is_checked_with_supabase(monkeypatch, driver_token):
    monkeypatch.setattr(auth.config, "SUPABASE_CONFIGURED", True)
    get = AsyncMock(return_value=Response(401))
    monkeypatch.setattr(auth.client, "get", get)
    response = TestClient(app).post("/orders", json=VALID_ORDER, headers={"Authorization": f"Bearer {driver_token}"})
    assert response.status_code == 401
    assert get.await_args.args[0].endswith("/auth/v1/user")


def test_auth_outage_fails_closed(monkeypatch):
    monkeypatch.setattr(auth.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(auth.client, "get", AsyncMock(side_effect=httpx.ConnectError("offline")))
    response = TestClient(app).post("/orders", json=VALID_ORDER, headers={"Authorization": "Bearer token"})
    assert response.status_code == 503


def test_production_rejects_client_priced_orders(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders.config, "ALLOW_DEMO_ORDERS", False)
    monkeypatch.setattr(orders, "require_user", AsyncMock(return_value=("token", "customer-123")))
    post = AsyncMock()
    monkeypatch.setattr(orders.client, "post", post)
    assert TestClient(app).post("/orders", json=VALID_ORDER).status_code == 503
    post.assert_not_awaited()


def test_cannot_impersonate_another_customer(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders.config, "ALLOW_DEMO_ORDERS", True)
    monkeypatch.setattr(orders, "require_user", AsyncMock(return_value=("token", "customer-123")))
    assert TestClient(app).post("/orders", json={**VALID_ORDER, "customer_id": "someone-else"}).status_code == 403


def test_out_of_zone_order_rejected(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders.config, "ALLOW_DEMO_ORDERS", True)
    monkeypatch.setattr(orders, "require_user", AsyncMock(return_value=("token", "customer-123")))
    assert TestClient(app).post("/orders", json={**VALID_ORDER, "latitude": 43.65, "longitude": -79.38}).status_code == 422


def test_consumer_is_not_an_approved_driver(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders, "require_user", AsyncMock(return_value=("token", "customer-123")))
    monkeypatch.setattr(orders.client, "get", AsyncMock(return_value=Response(200, [])))
    assert TestClient(app).get("/orders/feed").status_code == 403


@pytest.mark.parametrize("status", ["accepted", "picked_up", "delivered"])
def test_driver_cannot_update_another_drivers_order(monkeypatch, status):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders, "_require_driver", AsyncMock(return_value=("token", "driver-123")))
    monkeypatch.setattr(orders.client, "get", AsyncMock(return_value=Response(200, [{"accepted_by": "someone-else", "delivery_status": "accepted"}])))
    post, patch = AsyncMock(), AsyncMock()
    monkeypatch.setattr(orders.client, "post", post)
    monkeypatch.setattr(orders.client, "patch", patch)
    assert TestClient(app).post(f"/orders/{ORDER_ID}/status", json={"status": status}).status_code == 403
    post.assert_not_awaited()
    patch.assert_not_awaited()


def test_delivery_cannot_skip_pickup(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders, "_require_driver", AsyncMock(return_value=("token", "driver-123")))
    monkeypatch.setattr(orders.client, "get", AsyncMock(return_value=Response(200, [{"accepted_by": "driver-123", "delivery_status": "accepted"}])))
    assert TestClient(app).post(f"/orders/{ORDER_ID}/status", json={"status": "delivered"}).status_code == 409


def test_notify_requires_authentication():
    assert TestClient(app).post("/notify", json={"orderId": ORDER_ID, "kind": "new_message"}).status_code == 401


def test_client_cannot_broadcast_order_notifications(monkeypatch):
    monkeypatch.setattr(notify, "require_user", AsyncMock(return_value=("token", "customer-123")))
    assert TestClient(app).post("/notify", json={"orderId": ORDER_ID, "kind": "new_order"}).status_code == 403


def test_nonparticipant_cannot_send_push(monkeypatch):
    monkeypatch.setattr(notify, "require_user", AsyncMock(return_value=("token", "intruder")))
    monkeypatch.setattr(notify.client, "get", AsyncMock(return_value=Response(200, [{"customer_id": "customer", "accepted_by": "driver"}])))
    send = AsyncMock()
    monkeypatch.setattr(notify, "send_notification", send)
    assert TestClient(app).post("/notify", json={"orderId": ORDER_ID, "kind": "new_message", "senderId": "customer"}).status_code == 403
    send.assert_not_awaited()


def test_push_sender_comes_from_verified_session(monkeypatch):
    monkeypatch.setattr(notify, "require_user", AsyncMock(return_value=("token", "customer")))
    monkeypatch.setattr(notify.client, "get", AsyncMock(return_value=Response(200, [{"customer_id": "customer", "accepted_by": "driver"}])))
    send = AsyncMock(return_value={"sent": 1})
    monkeypatch.setattr(notify, "send_notification", send)
    response = TestClient(app).post("/notify", json={"orderId": ORDER_ID, "kind": "new_message", "senderId": "driver", "preview": "private chat text"})
    assert response.status_code == 200
    body = send.await_args.args[0]
    assert body.senderId == "customer"
    assert body.preview == "You have a new message."
