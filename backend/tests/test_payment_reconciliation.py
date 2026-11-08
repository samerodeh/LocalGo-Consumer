"""Offline checks for the paid-without-order audit."""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app import payment_reconciliation as audit


class Page:
    def __init__(self, events):
        self.events = events

    def auto_paging_iter(self):
        return iter(self.events)


def event(event_id, intent_id, order_id, *, app='localgo-server-cart'):
    intent = SimpleNamespace(id=intent_id, amount_received=1326,
        metadata={'app': app, 'order_id': order_id})
    return SimpleNamespace(id=event_id, data=SimpleNamespace(object=intent))


def test_audit_requires_both_provider_and_service_role():
    with pytest.raises(RuntimeError, match='service-role'):
        asyncio.run(audit.find_unpublished_payments())


def test_audit_reports_only_unresolved_paid_localgo_intents(monkeypatch, stripe_on, supabase_on):
    paid = str(uuid4())
    published = str(uuid4())
    unavailable = str(uuid4())
    events = [event('evt_1', 'pi_missing', paid),
              event('evt_2', 'pi_missing', paid),
              event('evt_3', 'pi_published', published),
              event('evt_4', 'pi_unknown', unavailable),
              event('evt_5', 'pi_other', str(uuid4()), app='other-app'),
              event('evt_6', 'pi_bad', 'not-an-order-id')]
    requested = []
    monkeypatch.setattr(audit.stripe.Event, 'list', lambda **kwargs:
                        (requested.append(kwargs), Page(events))[1])
    checked = []
    async def order_exists(order_id):
        checked.append(order_id)
        return {paid: False, published: True, unavailable: None}[order_id]
    monkeypatch.setattr(audit.payments, '_order_exists', order_exists)

    result = asyncio.run(audit.find_unpublished_payments(hours=2, grace_minutes=10, now=7200))
    assert requested == [{'type': 'payment_intent.succeeded',
                          'created': {'gte': 0, 'lte': 6600}, 'limit': 100}]
    assert checked == [paid, published, unavailable]
    assert [(r.payment_intent_id, r.status) for r in result] == [
        ('pi_missing', 'missing_order'),
        ('pi_unknown', 'lookup_unavailable'),
        ('pi_bad', 'invalid_order_metadata')]
    assert all(r.amount_cents == 1326 for r in result)


def test_audit_rejects_invalid_window(stripe_on, supabase_on):
    with pytest.raises(ValueError, match='window'):
        asyncio.run(audit.find_unpublished_payments(hours=0))

def test_auto_refund_claims_checkout_before_one_idempotent_refund(monkeypatch, stripe_on, supabase_on):
    from dataclasses import asdict
    from app import pricing
    from app.cart.checkout import Checkout
    from app.cart.models import Cart, CartCommand
    from app.cart.service import apply_command

    owner, order = uuid4(), uuid4()
    cart = apply_command(Cart(), CartCommand(operation='add', cart_revision=0,
                                            product_id='cheese-pizza-slice', quantity=2))
    quote = pricing.quote([('cheese-pizza-slice', 2)], 200)
    record = Checkout(order_id=order, user_id=owner, cart_revision=1, cart=cart,
                      tip_cents=200, status='pending', quote=asdict(quote), payment_intent_id='pi_paid')
    intent = SimpleNamespace(id='pi_paid', status='succeeded', amount=quote.total_cents,
        amount_received=quote.total_cents, currency='cad', metadata={
            'app': 'localgo-server-cart', 'order_id': str(order), 'customer_id': str(owner),
            'cart_revision': '1', 'quote_hash': record.fingerprint()})
    actions = []

    class Repository:
        async def get(self, user, order_id):
            assert (user, order_id) == (owner, order)
            return record
        async def claim_refund(self, current):
            actions.append('claim')
            current.status = 'refunding'
            return current
        async def record_refund(self, current, refund_id, *, succeeded):
            actions.append(('record', refund_id, succeeded))
            current.status = 'refunded' if succeeded else 'refunding'
            return current

    async def missing(_): return False
    monkeypatch.setattr(audit, 'CheckoutRepository', Repository)
    monkeypatch.setattr(audit.payments, '_order_exists', missing)
    monkeypatch.setattr(audit.stripe.PaymentIntent, 'retrieve', lambda _: intent)
    monkeypatch.setattr(audit.stripe.Refund, 'list', lambda **kwargs: Page([]))
    def create(**kwargs):
        actions.append(('refund', kwargs))
        return SimpleNamespace(id='re_paid', amount=quote.total_cents, status='succeeded')
    monkeypatch.setattr(audit.stripe.Refund, 'create', create)
    candidate = audit.Candidate('evt_paid', 'pi_paid', str(order), quote.total_cents, 'missing_order')
    assert asyncio.run(audit.refund_unpublished_payment(candidate)) == 'refunded'
    assert actions == ['claim', ('refund', {'payment_intent': 'pi_paid',
        'idempotency_key': f'localgo-unpublished-{order}'}), ('record', 're_paid', True)]

    actions.clear()
    assert asyncio.run(audit.refund_unpublished_payment(candidate)) == 'already_refunded'
    assert actions == []

    # A prior refund may have succeeded at Stripe before the database write.
    # Reconcile the existing refund instead of issuing a replacement.
    record.status = 'refunding'
    record.refund_id = 're_pending'
    existing = SimpleNamespace(id='re_pending', amount=quote.total_cents, status='pending')
    monkeypatch.setattr(audit.stripe.Refund, 'list', lambda **kwargs: Page([existing]))
    monkeypatch.setattr(audit.stripe.Refund, 'create', lambda **kwargs: pytest.fail('second refund'))
    assert asyncio.run(audit.refund_unpublished_payment(candidate)) == 'refund_pending'
    assert actions == ['claim', ('record', 're_pending', False)]
    existing.status = 'succeeded'
    actions.clear()
    assert asyncio.run(audit.refund_unpublished_payment(candidate)) == 'refunded'
    assert actions == ['claim', ('record', 're_pending', True)]


def test_auto_refund_refuses_published_or_legacy_payment(monkeypatch, stripe_on, supabase_on):
    order = str(uuid4())
    candidate = audit.Candidate('evt_paid', 'pi_paid', order, 1000, 'missing_order')
    legacy = SimpleNamespace(id='pi_paid', metadata={'app': 'localgo-consumer', 'order_id': order})
    monkeypatch.setattr(audit.stripe.PaymentIntent, 'retrieve', lambda _: legacy)
    assert asyncio.run(audit.refund_unpublished_payment(candidate)) == 'manual_review'
    assert asyncio.run(audit.refund_unpublished_payment(
        audit.Candidate('evt_unknown', 'pi_paid', order, 1000, 'lookup_unavailable'))) == 'manual_review'