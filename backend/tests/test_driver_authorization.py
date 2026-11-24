"""Driver access uses verified Auth identity and explicit administrator approval."""
from unittest.mock import AsyncMock
from uuid import UUID
import httpx
import pytest
from fastapi.testclient import TestClient
from app import config
from app.main import app
from app.routers import orders
from app import auth

UID = '22222222-2222-4222-8222-222222222222'


def response(code, value):
    return httpx.Response(code, json=value)


def test_forged_driver_token_is_rejected_before_any_dispatch_read(monkeypatch):
    monkeypatch.setattr(config, 'SUPABASE_CONFIGURED', True)
    get = AsyncMock(return_value=response(401, {'message': 'Invalid JWT'}))
    monkeypatch.setattr(auth.client, 'get', get)
    write = AsyncMock()
    monkeypatch.setattr(orders.client, 'post', write)
    result = TestClient(app).post('/driver/availability', headers={'Authorization': 'Bearer forged'}, json={'online': True})
    assert result.status_code == 401
    assert get.await_count == 1
    assert get.await_args.args[0].endswith('/auth/v1/user')
    write.assert_not_awaited()


def test_self_declared_driver_metadata_cannot_grant_access(monkeypatch):
    monkeypatch.setattr(config, 'SUPABASE_CONFIGURED', True)
    get = AsyncMock(side_effect=[response(200, {'id': UID, 'user_metadata': {'role': 'driver', 'approved': True}}), response(200, [])])
    monkeypatch.setattr(auth.client, 'get', get)
    result = TestClient(app).get('/orders/feed', headers={'Authorization': 'Bearer user-token'})
    assert result.status_code == 403
    assert get.await_count == 2
    assert get.await_args.kwargs['params']['id'] == f'eq.{UID}'


def test_approval_outage_fails_closed(monkeypatch):
    monkeypatch.setattr(config, 'SUPABASE_CONFIGURED', True)
    get = AsyncMock(side_effect=[response(200, {'id': UID}), response(500, {})])
    monkeypatch.setattr(auth.client, 'get', get)
    result = TestClient(app).post('/driver/offers/next', headers={'Authorization': 'Bearer user-token'})
    assert result.status_code == 503


def test_another_driver_cannot_write_order_progress(monkeypatch):
    monkeypatch.setattr(config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders, '_require_driver', AsyncMock(return_value=('driver-token', UID)))
    monkeypatch.setattr(orders.client, 'get', AsyncMock(return_value=response(200, [{'accepted_by': str(UUID(int=5)), 'delivery_status': 'picked_up'}])))
    write = AsyncMock()
    monkeypatch.setattr(orders.client, 'patch', write)
    result = TestClient(app).post('/orders/11111111-1111-4111-8111-111111111111/status', headers={'Authorization': 'Bearer driver-token'}, json={'status': 'delivered', 'photo_url': 'https://proof.test/dropoff.jpg'})
    assert result.status_code == 403
    write.assert_not_awaited()
