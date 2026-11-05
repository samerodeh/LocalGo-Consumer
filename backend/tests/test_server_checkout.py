from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import config
from app.auth import CustomerSession
from app.cart.checkout import Checkout, CheckoutRepository
from app.cart.models import Cart, CartCommand, CartError
from app.cart.service import apply_command
from app.routers import payments, orders


@pytest.fixture
def live_cart(monkeypatch, stripe_on, supabase_on):
    owner, order_id = uuid4(), uuid4()
    cart = apply_command(Cart(), CartCommand(operation='add', cart_revision=0,
                                           product_id='cheese-pizza-slice', quantity=2))
    record = Checkout(order_id=order_id, user_id=owner, cart_revision=1, cart=cart, tip_cents=200, status='pending')

    class Repository(CheckoutRepository):
        def __init__(self): pass
        async def lock(self, user, oid, revision, tip):
            if (user, oid, revision, tip) != (owner, order_id, 1, 200):
                raise CartError('CART_REVISION_CONFLICT', 'Stale checkout', 409)
            return record
        async def get(self, user, oid):
            assert user == owner and oid == order_id
            return record
        async def update(self, current, action, quote=None, payment_id=None):
            if action == 'prepare': record.quote = quote
            if action == 'attach': record.payment_intent_id = payment_id
            if action == 'consume': record.status = 'consumed'
            if action == 'release': record.status = 'released'
            return record

    async def customer(authorization):
        assert authorization == 'Bearer customer'
        return CustomerSession(owner, 'customer')

    monkeypatch.setattr(config, 'SERVER_CART_ENABLED', True)
    monkeypatch.setattr(payments, 'CheckoutRepository', Repository)
    monkeypatch.setattr(orders, 'CheckoutRepository', Repository)
    monkeypatch.setattr(payments, 'require_customer', customer)
    monkeypatch.setattr(orders, 'require_customer', customer)
    calls = []
    intent = SimpleNamespace(id='pi_cart', client_secret='private-client-secret', amount=1800,
                             amount_received=1800, status='requires_payment_method', currency='cad', metadata={})
    def create(**kwargs):
        calls.append(kwargs)
        intent.metadata = kwargs['metadata']
        return intent
    monkeypatch.setattr(payments.stripe.PaymentIntent, 'create', create)
    monkeypatch.setattr(payments.stripe.PaymentIntent, 'retrieve', lambda _: intent)
    return owner, order_id, record, intent, calls


def test_checkout_uses_frozen_server_lines_and_replays_intent(client, live_cart):
    owner, order_id, record, intent, calls = live_cart
    body = {'order_id': str(order_id), 'cart_revision': 1, 'tip_cents': 200}
    headers = {'Authorization': 'Bearer customer'}
    first = client.post('/payments/intent', json=body, headers=headers)
    assert first.status_code == 200
    assert first.json()['total_cents'] == 1800
    assert calls[0]['amount'] == 1800
    assert calls[0]['metadata']['customer_id'] == str(owner)
    assert calls[0]['metadata']['cart_revision'] == '1'
    assert calls[0]['metadata']['quote_hash'] == record.fingerprint()
    assert client.post('/payments/intent', json=body, headers=headers).json() == first.json()
    assert len(calls) == 1
    bad = client.post('/payments/intent', json={**body, 'items': [{'id': 'coke', 'quantity': 1}]}, headers=headers)
    assert bad.status_code == 422
    stale = client.post('/payments/intent', json={**body, 'cart_revision': 0}, headers=headers)
    assert stale.status_code == 409 and len(calls) == 1


def test_canceled_payment_releases_lock_but_paid_payment_does_not(client, live_cart, monkeypatch):
    _, order_id, record, intent, _ = live_cart
    headers = {'Authorization': 'Bearer customer'}
    client.post('/payments/intent', json={'order_id': str(order_id), 'cart_revision': 1, 'tip_cents': 200}, headers=headers)
    intent.status = 'succeeded'
    assert client.post(f'/payments/cart/{order_id}/cancel', headers=headers).status_code == 409
    assert record.status == 'pending'
    intent.status = 'requires_payment_method'
    monkeypatch.setattr(payments.stripe.PaymentIntent, 'cancel', lambda _: setattr(intent, 'status', 'canceled'))
    assert client.post(f'/payments/cart/{order_id}/cancel', headers=headers).status_code == 200
    assert record.status == 'released'


def test_order_publication_uses_paid_snapshot_and_consumes_cart(client, live_cart, monkeypatch):
    import httpx
    _, order_id, record, intent, _ = live_cart
    headers = {'Authorization': 'Bearer customer'}
    client.post('/payments/intent', json={'order_id': str(order_id), 'cart_revision': 1, 'tip_cents': 200}, headers=headers)
    intent.status = 'succeeded'
    rows = []

    class Database:
        async def post(self, url, **kwargs):
            rows.append(kwargs['json'])
            return httpx.Response(201 if len(rows) == 1 else 409, json={})

    async def notify(*args): pass
    monkeypatch.setattr(orders, 'client', Database())
    monkeypatch.setattr(orders, 'send_notification', notify)
    body = {'id': str(order_id), 'payment_intent_id': intent.id, 'restaurant_name': 'forged restaurant',
            'customer_id': str(uuid4()), 'dropoff_address': '2125 Guy Street', 'latitude': 45.49,
            'longitude': -73.58, 'subtotal': 0, 'delivery_fee': 0, 'tip': 0, 'total': 0,
            'items': [{'name': 'forged free food', 'quantity': 99}]}
    response = client.post('/orders', json=body, headers=headers)
    assert response.status_code == 200
    assert rows[0]['customer_id'] == str(record.user_id)
    assert rows[0]['restaurant_name'] == 'Al Taib'
    assert rows[0]['order_total'] == 18.0
    assert rows[0]['items'] == ['2× Cheese Pizza Slice']
    assert record.status == 'consumed'
    assert client.post('/orders', json=body, headers=headers).json()['duplicate'] is True
    intent.amount_received = 1
    assert client.post('/orders', json=body, headers=headers).status_code == 402
    assert len(rows) == 2


def test_quote_fingerprint_cannot_be_replaced_by_equal_total(client, live_cart):
    _, order_id, record, intent, _ = live_cart
    body = {'order_id': str(order_id), 'cart_revision': 1, 'tip_cents': 200}
    headers = {'Authorization': 'Bearer customer'}
    assert client.post('/payments/intent', json=body, headers=headers).status_code == 200
    intent.metadata['quote_hash'] = 'wrong-even-if-total-matches'
    assert client.post('/payments/intent', json=body, headers=headers).status_code == 409
