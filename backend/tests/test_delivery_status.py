"""The status API delegates the atomic write to PostgreSQL and notifies once.

The database harness separately verifies timestamps, ownership, proof objects,
checklists, direct-write denial, rollback, and idempotent retries.
"""
from unittest.mock import AsyncMock
import httpx
import pytest
from fastapi.testclient import TestClient
from app import config
from app.main import app
from app.routers import orders

UID='22222222-2222-4222-8222-222222222222'
ORDER='11111111-1111-4111-8111-111111111111'
STAMP='2026-11-23T10:00:00+00:00'


@pytest.fixture
def status_api(monkeypatch):
    monkeypatch.setattr(config, 'SUPABASE_CONFIGURED', True)
    monkeypatch.setattr(orders, '_require_driver', AsyncMock(return_value=('driver-token',UID)))
    get=AsyncMock(return_value=httpx.Response(200,json=[{'accepted_by':UID,'delivery_status':'picked_up','items':['1× Meal']}]))
    post=AsyncMock(return_value=httpx.Response(200,json={'ok':True,'changed':True,'updatedAt':STAMP}))
    push=AsyncMock()
    monkeypatch.setattr(orders.client,'get',get)
    monkeypatch.setattr(orders.client,'post',post)
    monkeypatch.setattr(orders,'send_notification',push)
    return TestClient(app),get,post,push


@pytest.mark.parametrize('status,kind',[('picked_up','order_picked_up'),('nearby','order_nearby'),('arrived','order_arrived'),('delivered','order_delivered')])
def test_atomic_status_notifies_and_returns_database_timestamp(status_api,status,kind):
    client,get,post,push=status_api
    get.return_value=httpx.Response(200,json=[{'accepted_by':UID,'delivery_status':'accepted' if status=='picked_up' else 'picked_up','items':['1× Meal']}])
    r=client.post(f'/orders/{ORDER}/status',json={'status':status,'verified_items':[0],'photo_url':'https://proof.test/image.jpg'})
    assert r.status_code==200
    assert r.json()['updatedAt']==STAMP
    assert post.await_args.args[0].endswith('/rpc/driver_update_status')
    assert post.await_args.kwargs['json']=={'p_order_id':ORDER,'p_status':status,'p_photo_url':'https://proof.test/image.jpg','p_verified_items':[0]}
    assert push.await_args.args[0].kind==kind


def test_decline_uses_expiring_offer_transaction_without_customer_notification(status_api):
    client,get,post,push=status_api
    get.return_value=httpx.Response(200,json=[{'accepted_by':None,'delivery_status':'available'}])
    r=client.post(f'/orders/{ORDER}/status',json={'status':'declined'})
    assert r.status_code==200
    assert post.await_args.args[0].endswith('/rpc/driver_decline_offer')
    push.assert_not_awaited()


def test_retry_uses_database_idempotence_without_duplicate_notification(status_api):
    client,get,post,push=status_api
    get.return_value=httpx.Response(200,json=[{'accepted_by':UID,'delivery_status':'delivered'}])
    post.return_value=httpx.Response(200,json={'ok':True,'changed':False,'updatedAt':STAMP})
    r=client.post(f'/orders/{ORDER}/status',json={'status':'delivered','photo_url':'https://proof.test/image.jpg'})
    assert r.status_code==200 and r.json()['updatedAt']==STAMP
    push.assert_not_awaited()


def test_failed_atomic_write_never_notifies_success(status_api):
    client,get,post,push=status_api
    post.return_value=httpx.Response(500,json={})
    r=client.post(f'/orders/{ORDER}/status',json={'status':'delivered','photo_url':'https://proof.test/image.jpg'})
    assert r.status_code==502
    push.assert_not_awaited()


def test_database_proof_validation_failure_is_reported(status_api):
    client,get,post,push=status_api
    post.return_value=httpx.Response(400,json={'code':'22023'})
    r=client.post(f'/orders/{ORDER}/status',json={'status':'delivered','photo_url':'https://proof.test/image.jpg'})
    assert r.status_code==422
    push.assert_not_awaited()


def test_status_requires_a_driver_token(monkeypatch):
    monkeypatch.setattr(config,'SUPABASE_CONFIGURED',True)
    assert TestClient(app).post(f'/orders/{ORDER}/status',json={'status':'picked_up'}).status_code==401
