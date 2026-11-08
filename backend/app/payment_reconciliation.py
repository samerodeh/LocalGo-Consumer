"""Audit and opt-in refund of succeeded payments that lack a dispatch order.

Run this on a schedule with the backend's Stripe and Supabase service keys. It
leaves a grace period for the normal app/webhook race. Audit mode never creates
orders or releases checkout locks. Auto-refund mode uses the database fence.
A nonzero exit needs operator attention.
"""

import argparse
import asyncio
import json
import time
from dataclasses import asdict, dataclass
from uuid import UUID

import stripe

from . import config
from .cart.checkout import CheckoutRepository
from .cart.payment_binding import metadata_of, verify_intent
from .routers import payments


@dataclass(frozen=True)
class Candidate:
    event_id: str
    payment_intent_id: str
    order_id: str | None
    amount_cents: int
    status: str


async def find_unpublished_payments(*, hours: int = 720, grace_minutes: int = 15,
                                    now: int | None = None) -> list[Candidate]:
    if not (config.STRIPE_CONFIGURED and config.SUPABASE_CONFIGURED
            and config.SUPABASE_SERVICE_ROLE_KEY):
        raise RuntimeError('Stripe and service-role order lookup must be configured.')
    if not (1 <= hours <= 720 and 1 <= grace_minutes <= 1440):
        raise ValueError('Invalid audit window.')

    current = int(time.time() if now is None else now)
    cutoff = current - grace_minutes * 60
    stripe.api_key = config.STRIPE_SECRET_KEY
    events = stripe.Event.list(type='payment_intent.succeeded',
        created={'gte': current - hours * 3600, 'lte': cutoff}, limit=100)

    candidates: list[Candidate] = []
    seen: set[str] = set()
    for event in events.auto_paging_iter():
        intent = event.data.object
        intent_id = getattr(intent, 'id', None)
        if not isinstance(intent_id, str) or intent_id in seen:
            continue
        metadata = metadata_of(intent)
        if metadata.get('app') not in ('localgo-consumer', 'localgo-server-cart'):
            continue
        seen.add(intent_id)
        order_id = metadata.get('order_id')
        try:
            order_id = str(UUID(order_id))
        except (TypeError, ValueError, AttributeError):
            order_id = None
        if order_id is None:
            status = 'invalid_order_metadata'
        else:
            exists = await payments._order_exists(order_id)
            if exists is True:
                continue
            status = 'missing_order' if exists is False else 'lookup_unavailable'
        candidates.append(Candidate(str(event.id), intent_id, order_id,
            int(getattr(intent, 'amount_received', 0)), status))
    return candidates


async def refund_unpublished_payment(candidate: Candidate) -> str:
    """Refund only an owned server-cart charge claimed against order insertion."""
    if candidate.status != 'missing_order' or candidate.order_id is None:
        return 'manual_review'
    stripe.api_key = config.STRIPE_SECRET_KEY
    intent = await asyncio.to_thread(stripe.PaymentIntent.retrieve, candidate.payment_intent_id)
    metadata = metadata_of(intent)
    if metadata.get('app') != 'localgo-server-cart' or metadata.get('order_id') != candidate.order_id:
        return 'manual_review'
    try:
        owner = UUID(metadata['customer_id'])
        repository = CheckoutRepository()
        record = await repository.get(owner, UUID(candidate.order_id))
        if record.payment_intent_id != intent.id:
            return 'manual_review'
        verify_intent(intent, record, paid=True)
        if record.status == 'refunded':
            return 'already_refunded'
        if record.status not in ('pending', 'refunding'):
            return 'manual_review'
        # The read protects against a stale audit result; the RPC below repeats
        # it under the same database lock used by the order INSERT trigger.
        if await payments._order_exists(candidate.order_id) is not False:
            return 'order_or_lookup_changed'
        record = await repository.claim_refund(record)
        if record.status == 'refunded':
            return 'already_refunded'
        if record.status != 'refunding':
            return 'manual_review'
        refunds = await asyncio.to_thread(lambda: list(stripe.Refund.list(
            payment_intent=intent.id, limit=100).auto_paging_iter()))
        if refunds:
            if len(refunds) != 1 or refunds[0].amount != record.priced().total_cents \
                    or refunds[0].status not in ('pending', 'succeeded') \
                    or record.refund_id not in (None, refunds[0].id):
                return 'manual_review'
            refund = refunds[0]
        else:
            if record.refund_id is not None:
                return 'manual_review'
            refund = await asyncio.to_thread(lambda: stripe.Refund.create(
                payment_intent=intent.id,
                idempotency_key=f'localgo-unpublished-{candidate.order_id}'))
        if refund.status not in ('pending', 'succeeded'):
            return 'manual_review'
        await repository.record_refund(record, refund.id, succeeded=refund.status == 'succeeded')
        return 'refunded' if refund.status == 'succeeded' else 'refund_pending'
    except (KeyError, TypeError, ValueError):
        return 'manual_review'


def main() -> int:
    parser = argparse.ArgumentParser(description='Audit paid LocalGo intents without dispatch orders.')
    parser.add_argument('--hours', type=int, default=720)
    parser.add_argument('--grace-minutes', type=int, default=15)
    parser.add_argument('--auto-refund', action='store_true', help='Refund fenced server-cart orphans after at least one hour.')
    args = parser.parse_args()
    if args.auto_refund and args.grace_minutes < 60:
        parser.error('Automatic refunds require at least a 60-minute grace period.')
    async def run():
        candidates = await find_unpublished_payments(
            hours=args.hours, grace_minutes=args.grace_minutes)
        if not args.auto_refund:
            return candidates, None
        results = []
        for candidate in candidates:
            try:
                action = await refund_unpublished_payment(candidate)
            except Exception:
                action = 'manual_review'
            results.append({**asdict(candidate), 'action': action})
        return candidates, results

    try:
        candidates, results = asyncio.run(run())
    except Exception as exc:
        print(f'Payment reconciliation could not complete: {type(exc).__name__}.')
        return 2
    if results is None:
        print(json.dumps({'candidates': [asdict(candidate) for candidate in candidates]}))
        return 1 if candidates else 0
    print(json.dumps({'results': results}))
    return 1 if any(item['action'] not in ('refunded', 'already_refunded') for item in results) else 0


if __name__ == '__main__':
    raise SystemExit(main())