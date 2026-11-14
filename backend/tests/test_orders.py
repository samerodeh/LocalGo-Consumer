from unittest.mock import AsyncMock
import pytest

from fastapi.testclient import TestClient

from app.main import app
from app.routers import orders


class Response:
    def __init__(self, status_code: int, body=None, text: str = ""):
        self.status_code = status_code
        self._body = [] if body is None else body
        self.text = text

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def authenticated_orders(monkeypatch):
    monkeypatch.setattr(orders, "require_user", AsyncMock(return_value=("customer-token", "customer-123")))
    monkeypatch.setattr(orders, "_require_driver", AsyncMock(return_value=("driver-token", "driver-123")))
    monkeypatch.setattr(orders.config, "ALLOW_DEMO_ORDERS", True)


VALID_ORDER = {
    "restaurant_name": "Al Taib",
    "restaurant_address": "123 Main St",
    "customer_name": "Ada Lovelace",
    "dropoff_address": "1510 De Maisonneuve Ouest",
    "latitude": 45.496339,
    "longitude": -73.578666,
    "subtotal": 20,
    "delivery_fee": 5,
    "tip": 2,
    "total": 27,
    "items": [{"name": "Chicken shawarma", "quantity": 2}],
}


def test_place_order_rejects_an_unverified_delivery_location(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    response = TestClient(app).post("/orders", json={**VALID_ORDER, "latitude": 0, "longitude": 0})

    assert response.status_code == 422
    assert response.json()["detail"] == "The delivery address has no verified location."


def test_place_order_publishes_a_normalized_dispatch_row(monkeypatch):
    post = AsyncMock(return_value=Response(201))
    notify = AsyncMock()
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders.client, "post", post)
    monkeypatch.setattr(orders, "send_notification", notify)

    response = TestClient(app).post("/orders", json={**VALID_ORDER, "id": "11111111-1111-4111-8111-111111111111"})

    assert response.status_code == 200
    assert response.json() == {"id": "11111111-1111-4111-8111-111111111111"}
    row = post.await_args.kwargs["json"]
    assert row["id"] == "11111111-1111-4111-8111-111111111111"
    assert row["item_count"] == 2
    assert row["items"] == ["2× Chicken shawarma"]
    assert row["order_total"] == 27
    notify.assert_awaited_once()


def test_driver_feed_requires_a_signed_in_driver(monkeypatch):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)

    from fastapi import HTTPException
    monkeypatch.setattr(orders, "_require_driver", AsyncMock(side_effect=HTTPException(401, "Sign in to continue")))
    response = TestClient(app).get("/orders/feed")

    assert response.status_code == 401
    assert response.json()["detail"] == "Sign in to continue"


def test_driver_feed_maps_database_rows_and_private_status(monkeypatch, driver_token):
    monkeypatch.setattr(orders.config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(orders.client, "get", AsyncMock(side_effect=[
        Response(200, [{
            "id": "order-1", "order_number": "#LG-1", "restaurant_name": "Al Taib",
            "restaurant_address": "123 Main", "customer_name": "Ada", "dropoff_address": "1510 De Maisonneuve",
            "item_count": 2, "order_total": "27.00", "distance_km": "2.5", "accepted_by": "driver-123",
            "customer_id": "customer-123", "created_at": "2026-01-01T00:00:00Z", "items": ["2× Shawarma"],
        }]),
        Response(200, [{"order_id": "order-1", "status": "accepted", "updated_at": "2026-01-01T00:01:00Z"}]),
    ]))

    response = TestClient(app).get("/orders/feed", headers={"Authorization": f"Bearer {driver_token}"})

    assert response.status_code == 200
    assert response.json()["orders"] == [{
        "id": "order-1", "orderNumber": "#LG-1", "restaurantName": "Al Taib", "restaurantAddress": "123 Main",
        "customerName": "Ada", "dropoffAddress": "1510 De Maisonneuve", "itemCount": 2, "orderTotal": 27.0,
        "distanceKm": 2.5, "dropoffLatitude": None, "dropoffLongitude": None, "deliveryInstructions": "", "deliveryPreference": None, "entryCode": "", "pickupNotes": "", "guaranteedPayCents": None, "tipCents": 0, "acceptedAt": None, "deliveredAt": None, "status": "accepted", "statusUpdatedAt": "2026-01-01T00:01:00Z",
        "acceptedBy": "driver-123", "customerId": "customer-123", "createdAt": "2026-01-01T00:00:00Z", "items": ["2× Shawarma"],
    }]


def test_overlay_outage_is_not_returned_as_an_available_feed(monkeypatch):
    monkeypatch.setattr(orders.config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders.client, 'get', AsyncMock(side_effect=[Response(200, []), Response(500)]))
    assert TestClient(app).get('/orders/feed').status_code == 502


def test_claimed_order_uses_shared_progress_when_overlay_is_stale():
    row = {
        'id': 'one', 'order_number': '#LG-1', 'restaurant_name': 'Al Taib',
        'restaurant_address': 'Montreal', 'customer_name': 'Test', 'dropoff_address': 'Montreal',
        'item_count': 1, 'order_total': 20, 'distance_km': 2.5, 'created_at': '2026-11-11T10:00:00Z',
        'accepted_by': 'driver-123', 'delivery_status': 'picked_up',
    }
    assert orders._map_row(row, {'status': 'accepted', 'updated_at': None})['status'] == 'picked_up'
    assert orders._map_row(row, None)['status'] == 'picked_up'


def test_progress_reaches_customer_without_service_key(monkeypatch):
    monkeypatch.setattr(orders.config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders.config, 'SUPABASE_SERVICE_ROLE_KEY', '')
    monkeypatch.setattr(orders.client, 'get', AsyncMock(return_value=Response(200, [{'accepted_by': 'driver-123', 'delivery_status': 'accepted', 'items': ['1× Shawarma']}])))
    patch = AsyncMock(return_value=Response(200, [{'id': '11111111-1111-4111-8111-111111111111'}]))
    monkeypatch.setattr(orders.client, 'patch', patch)
    monkeypatch.setattr(orders.client, 'post', AsyncMock(return_value=Response(201)))
    monkeypatch.setattr(orders, 'send_notification', AsyncMock())
    response = TestClient(app).post('/orders/11111111-1111-4111-8111-111111111111/status', json={'status': 'picked_up', 'verified_items': [0], 'photo_url': 'https://proof.test/photo.jpg'})
    assert response.status_code == 200
    assert patch.await_args.kwargs['headers']['Authorization'] == 'Bearer driver-token'
    assert patch.await_args.kwargs['json']['pickup_photo_url'] == 'https://proof.test/photo.jpg'


@pytest.mark.parametrize('response', [Response(500), Response(200, [])])
def test_failed_customer_progress_does_not_report_success(monkeypatch, response):
    monkeypatch.setattr(orders.config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders.client, 'get', AsyncMock(return_value=Response(200, [{'accepted_by': 'driver-123', 'delivery_status': 'accepted', 'items': ['1× Shawarma']}])))
    monkeypatch.setattr(orders.client, 'patch', AsyncMock(return_value=response))
    post = AsyncMock()
    monkeypatch.setattr(orders.client, 'post', post)
    response = TestClient(app).post('/orders/11111111-1111-4111-8111-111111111111/status', json={'status': 'picked_up', 'verified_items': [0]})
    assert response.status_code == 502
    post.assert_not_awaited()
