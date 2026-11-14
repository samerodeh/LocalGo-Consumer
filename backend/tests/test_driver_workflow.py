from datetime import datetime, timezone
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from app.main import app
from app.routers import driver, orders
from test_orders import Response


def test_availability_and_offers_require_driver_approval(monkeypatch):
    from fastapi import HTTPException
    monkeypatch.setattr(driver, '_require_driver', AsyncMock(side_effect=HTTPException(403, 'Approval required')))
    for method, path, body in [('get','/driver/availability',None),('post','/driver/availability',{'online': True}),('post','/driver/offers/next',{})]:
        response = getattr(TestClient(app), method)(path, **({'json': body} if body is not None else {}))
        assert response.status_code == 403


def test_availability_is_not_optimistic_when_database_fails(monkeypatch):
    monkeypatch.setattr(driver, '_require_driver', AsyncMock(return_value=('token','driver')))
    monkeypatch.setattr(driver.client, 'post', AsyncMock(return_value=Response(500)))
    assert TestClient(app).post('/driver/availability', json={'online': True}).status_code == 503


def test_invalid_availability_is_rejected():
    assert TestClient(app).post('/driver/availability', json={'online': 'false'}).status_code == 422


def test_activity_uses_pay_in_cents_and_clips_shifts_at_midnight():
    now = datetime(2026,11,11,17,tzinfo=timezone.utc)
    stats = driver.summarize_activity([
        {'delivered_at': '2026-11-11T16:00:00Z', 'driver_pay_cents': 500},
        {'delivered_at': '2026-11-11T16:10:00Z', 'driver_pay_cents': 500},
    ], [{'started_at':'2026-11-11T04:30:00Z','ended_at':'2026-11-11T05:30:00Z'}], now)
    assert stats['today']['earningsCents'] == 1000
    assert stats['today']['deliveries'] == 2
    assert stats['today']['activeSeconds'] == 1800
    assert stats['week'][-2]['activeSeconds'] == 1800
    assert len(stats['week']) == 7


def test_unknown_historical_pay_is_never_reported_as_zero():
    stats = driver.summarize_activity([{'delivered_at':'2026-11-11T16:00:00Z','driver_pay_cents':None}], [], datetime(2026,11,11,17,tzinfo=timezone.utc))
    assert stats['today']['earningsCents'] is None


def test_offer_claim_uses_atomic_expiry_checked_rpc(monkeypatch):
    monkeypatch.setattr(orders.config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders, '_require_driver', AsyncMock(return_value=('token','driver')))
    post = AsyncMock(return_value=Response(200, None))
    monkeypatch.setattr(orders.client, 'post', post)
    assert TestClient(app).post('/orders/11111111-1111-4111-8111-111111111111/accept').status_code == 409
    assert post.await_args.args[0].endswith('/rpc/driver_accept_offer')


def test_incomplete_pickup_checklist_is_rejected(monkeypatch):
    monkeypatch.setattr(orders.config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders, '_require_driver', AsyncMock(return_value=('token','driver')))
    monkeypatch.setattr(orders.client, 'get', AsyncMock(return_value=Response(200,[{'accepted_by':'driver','delivery_status':'accepted','items':['one','two']}])) )
    patch = AsyncMock(); monkeypatch.setattr(orders.client, 'patch', patch)
    response = TestClient(app).post('/orders/11111111-1111-4111-8111-111111111111/status', json={'status':'picked_up','verified_items':[0]})
    assert response.status_code == 422
    patch.assert_not_awaited()


def test_retried_completion_does_not_retime_earnings_or_send_another_notification(monkeypatch):
    monkeypatch.setattr(orders.config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders, '_require_driver', AsyncMock(return_value=('token','driver')))
    monkeypatch.setattr(orders.client, 'get', AsyncMock(return_value=Response(200,[{'accepted_by':'driver','delivery_status':'delivered'}])))
    patch, post, push = AsyncMock(), AsyncMock(), AsyncMock()
    monkeypatch.setattr(orders.client, 'patch', patch)
    monkeypatch.setattr(orders.client, 'post', post)
    monkeypatch.setattr(orders, 'send_notification', push)
    response = TestClient(app).post('/orders/11111111-1111-4111-8111-111111111111/status', json={'status':'delivered','photo_url':'https://proof.test/photo.jpg'})
    assert response.status_code == 200
    patch.assert_not_awaited()
    post.assert_not_awaited()
    push.assert_not_awaited()


def test_new_order_push_does_not_interrupt_an_active_delivery(monkeypatch):
    from app.routers import notify
    monkeypatch.setattr(notify.config, 'SUPABASE_SERVICE_ROLE_KEY', 'fixture-key')
    monkeypatch.setattr(notify.client, 'get', AsyncMock(side_effect=[
        Response(200,[{'id':'11111111-1111-4111-8111-111111111111','order_number':'#LG-1','item_count':1,'order_total':20}]),
        Response(200,[{'driver_id':'driver'}]),
        Response(200,[{'accepted_by':'driver'}]),
    ]))
    post = AsyncMock(); monkeypatch.setattr(notify.client, 'post', post)
    import asyncio, json
    response = asyncio.run(notify.send_notification(notify.NotifyBody(orderId='11111111-1111-4111-8111-111111111111',kind='new_order')))
    assert json.loads(response.body)['sent'] == 0
    post.assert_not_awaited()
