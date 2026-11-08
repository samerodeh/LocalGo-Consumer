"""Read-only audit of succeeded Stripe payments that lack a dispatch order.

Run this on a schedule with the backend's Stripe and Supabase service keys. It
leaves a grace period for the normal app/webhook race and never refunds, creates
orders, or releases checkout locks. A nonzero exit needs operator attention.
"""

import argparse
import asyncio
import json
import time
from dataclasses import asdict, dataclass
from uuid import UUID

import stripe

from . import config
from .cart.payment_binding import metadata_of
from .routers import payments


@dataclass(frozen=True)
class Candidate:
    event_id: str
    payment_intent_id: str
    order_id: str | None
    amount_cents: int
    status: str


async def find_unpublished_payments(*, hours: int = 48, grace_minutes: int = 15,
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


def main() -> int:
    parser = argparse.ArgumentParser(description='Audit paid LocalGo intents without dispatch orders.')
    parser.add_argument('--hours', type=int, default=48)
    parser.add_argument('--grace-minutes', type=int, default=15)
    args = parser.parse_args()
    try:
        candidates = asyncio.run(find_unpublished_payments(
            hours=args.hours, grace_minutes=args.grace_minutes))
    except (RuntimeError, ValueError, stripe.StripeError) as exc:
        print(f'Payment reconciliation could not complete: {type(exc).__name__}.')
        return 2
    print(json.dumps({'candidates': [asdict(candidate) for candidate in candidates]}))
    return 1 if candidates else 0


if __name__ == '__main__':
    raise SystemExit(main())