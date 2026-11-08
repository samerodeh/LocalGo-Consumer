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