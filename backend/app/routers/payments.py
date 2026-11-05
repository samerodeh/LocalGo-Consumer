"""Stripe payments — the real authorize/capture that replaced the app's
simulated `setTimeout` in src/lib/placeOrder.ts.

Flow (the app drives it in this order):

  1. App generates the order id up front and POSTs the cart here as **item ids
     and quantities only** — no prices, no total.
  2. This module reprices the cart from the backend's own menu (`pricing.py`)
     and creates a PaymentIntent for that amount, stamping the breakdown and
     the order id into the intent's metadata.
  3. App presents Stripe's PaymentSheet with the returned client secret.
  4. On success the app calls POST /orders with the same order id and the
     payment intent id; `routers/orders.py` re-reads the intent from Stripe,
     confirms it actually succeeded, and takes the recorded amounts from the
     intent metadata rather than from the request body.

So the client never gets to name a price, and an order can't exist without a
matching succeeded charge. The `order_id` doubles as the Stripe idempotency
key, so a double tap reuses one intent instead of creating a second charge.
"""

import uuid

import stripe
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field
from ..auth import require_customer
from ..cart.checkout import CheckoutRepository
from ..cart.models import CartError

from .. import config, pricing
from ..postgrest import REST_URL, bearer_from, client, headers, jwt_sub
from ..rate_limit import rate_limited

router = APIRouter(prefix="/payments")


def _require_stripe() -> None:
    if not config.STRIPE_CONFIGURED:
        raise HTTPException(503, "Payments are not configured on the backend")
    stripe.api_key = config.STRIPE_SECRET_KEY


class QuoteItem(BaseModel):
    # The menu item id from src/data/menu.ts — NOT a display name, and never a
    # price. Prices come from pricing.PRICES and nowhere else.
    id: str = Field(min_length=1, max_length=200)
    quantity: int = Field(ge=1, le=pricing.MAX_QUANTITY)


class IntentBody(BaseModel):
    # Client-generated so the app can reference the order before it's paid for,
    # and so a retry lands on the same Stripe idempotency key.
    order_id: str = Field(min_length=1, max_length=64)
    items: list[QuoteItem] = Field(default_factory=list, max_length=pricing.MAX_LINES)
    cart_revision: int | None = Field(default=None, ge=0, strict=True)
    tip_cents: int = Field(default=0, ge=0, le=pricing.MAX_TIP_CENTS)


@router.post("/intent")
async def create_intent(body: IntentBody, authorization: str | None = Header(default=None)):
    _require_stripe()

    # Creating PaymentIntents is cheap but not free, and it's an unauthenticated
    # endpoint (checkout works in demo mode without a Supabase session).
    if rate_limited(f"payments:intent:{body.order_id}"):
        raise HTTPException(429, "Too many payment attempts — wait a moment and try again.")

    try:
        uuid.UUID(body.order_id)
    except ValueError:
        raise HTTPException(422, "order_id must be a UUID") from None

    if config.SERVER_CART_ENABLED:
        return await _server_cart_intent(body, authorization)
    if body.cart_revision is not None:
        raise HTTPException(503, "Server cart checkout is not enabled on this backend.")

    try:
        quote = pricing.quote([(i.id, i.quantity) for i in body.items], body.tip_cents)
    except pricing.PricingError as exc:
        # 422 rather than 400: the request was well-formed, the cart wasn't
        # priceable. Same status the delivery-location gate uses.
        raise HTTPException(422, str(exc)) from None

    # Ties the charge to the signed-in customer when there is one. Optional:
    # demo mode has no Supabase session and still needs to check out.
    customer_id = jwt_sub(bearer_from(authorization)) or ""

    metadata = {
        **quote.as_metadata(),
        "order_id": body.order_id,
        "customer_id": customer_id,
        "app": "localgo-consumer",
    }

    try:
        intent = stripe.PaymentIntent.create(
            amount=quote.total_cents,
            currency=quote.currency,
            metadata=metadata,
            automatic_payment_methods={"enabled": True},
            # Same order id => same intent. Protects against double-taps and
            # retries after a dropped response.
            idempotency_key=f"localgo-order-{body.order_id}",
        )
    except stripe.StripeError as exc:
        print(f"[payments] intent create failed: {type(exc).__name__}: {exc}")
        raise HTTPException(502, "Could not start the payment. Please try again.") from None

    # An idempotent replay can return an intent whose amount was fixed by the
    # first call. If the cart changed in between, the client would present a
    # sheet for the old amount — refuse instead of silently charging the wrong
    # total.
    if intent.amount != quote.total_cents:
        raise HTTPException(
            409,
            "This order was already started at a different total. Start a new checkout.",
        )

    return {
        "publishable_key": config.STRIPE_PUBLISHABLE_KEY,
        "client_secret": intent.client_secret,
        "payment_intent_id": intent.id,
        "currency": quote.currency,
        "subtotal_cents": quote.subtotal_cents,
        "delivery_fee_cents": quote.delivery_fee_cents,
        "tip_cents": quote.tip_cents,
        "total_cents": quote.total_cents,
    }


async def _server_cart_intent(body: IntentBody, authorization: str | None):
    from ..cart.payment_binding import verify_intent
    customer = await require_customer(authorization)
    if body.cart_revision is None or body.items:
        raise HTTPException(422, "Server checkout requires cart_revision, not client item lists.")
    repository = CheckoutRepository()
    try:
        record = await repository.lock(customer.user_id, uuid.UUID(body.order_id), body.cart_revision, body.tip_cents)
        record = await repository.prepare(record)
        quote = record.priced()
        metadata = {**quote.as_metadata(), "order_id": str(record.order_id),
                    "customer_id": str(customer.user_id), "cart_revision": str(record.cart_revision),
                    "quote_hash": record.fingerprint(), "app": "localgo-server-cart"}
        try:
            if record.payment_intent_id:
                intent = stripe.PaymentIntent.retrieve(record.payment_intent_id)
            else:
                intent = stripe.PaymentIntent.create(amount=quote.total_cents, currency=quote.currency,
                    metadata=metadata, automatic_payment_methods={"enabled": True},
                    idempotency_key=f"localgo-order-{body.order_id}")
        except stripe.StripeError:
            raise HTTPException(502, "Payment result is uncertain. Retry the same checkout order ID.") from None
        verify_intent(intent, record)
        if not record.payment_intent_id:
            await repository.update(record, "attach", payment_id=intent.id)
        return {"publishable_key": config.STRIPE_PUBLISHABLE_KEY, "client_secret": intent.client_secret,
                "payment_intent_id": intent.id, "payment_status": intent.status,
                "cart_revision": record.cart_revision, "currency": quote.currency,
                "subtotal_cents": quote.subtotal_cents, "delivery_fee_cents": quote.delivery_fee_cents,
                "tip_cents": quote.tip_cents, "total_cents": quote.total_cents}
    except CartError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from None


@router.post("/cart/{order_id}/cancel")
async def cancel_cart_checkout(order_id: uuid.UUID, authorization: str | None = Header(default=None)):
    _require_stripe()
    if not config.SERVER_CART_ENABLED:
        raise HTTPException(503, "Server cart checkout is disabled.")
    customer = await require_customer(authorization)
    repository = CheckoutRepository()
    try:
        record = await repository.get(customer.user_id, order_id)
        if record.status == "released":
            return {"released": True}
        if record.status == "consumed":
            raise HTTPException(409, "This checkout is already placed.")
        if record.payment_intent_id:
            try:
                intent = stripe.PaymentIntent.retrieve(record.payment_intent_id)
                if intent.status in ("succeeded", "processing"):
                    raise HTTPException(409, "A paid or processing checkout cannot be released. Reconcile the order first.")
                if intent.status != "canceled":
                    stripe.PaymentIntent.cancel(intent.id)
            except stripe.StripeError:
                raise HTTPException(502, "Could not verify cancellation; the cart remains locked.") from None
        await repository.update(record, "release", payment_id=record.payment_intent_id)
        return {"released": True}
    except CartError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from None


async def _order_exists(order_id: str) -> bool | None:
    """Has this order actually been recorded? None means we couldn't tell.

    Needs the service-role key: the anon role has INSERT but no SELECT on
    `orders` (the RLS gotcha documented in routers/orders.py), so an anon read
    here would come back empty and report every charge as orphaned.
    """
    if not config.SUPABASE_CONFIGURED or not config.SUPABASE_SERVICE_ROLE_KEY:
        return None
    try:
        res = await client.get(
            f"{REST_URL}/orders",
            params={"id": f"eq.{order_id}", "select": "id"},
            headers=headers(service=True),
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[payments] order lookup failed: {type(exc).__name__}: {exc}")
        return None
    if res.status_code != 200:
        print(f"[payments] order lookup returned {res.status_code}")
        return None
    return len(res.json()) > 0


@router.post("/webhook")
async def stripe_webhook(request: Request, stripe_signature: str = Header(default="")):
    """Stripe's out-of-band truth about a charge.

    The happy path doesn't need this — POST /orders verifies the intent
    directly. It matters for the case the app can't report: the customer's
    payment succeeds but the phone dies, loses signal, or the app is killed
    before it calls /orders. Those charges would otherwise be money taken for an
    order no driver ever sees, with nothing anywhere recording it.

    On a successful payment this looks up the matching order row and logs an
    ORPHANED CHARGE line when there isn't one, so it can be refunded or
    completed by hand.

    RACE: Stripe often delivers this before the app's own POST /orders lands, so
    a freshly orphaned charge can be a false alarm that resolves itself seconds
    later. Always re-check the order id before refunding anything. Catching the
    genuine cases properly needs a periodic sweep over recent intents, not just
    this hook — see LIST.md.
    """
    if not config.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhooks are not configured")

    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(
            payload, stripe_signature, config.STRIPE_WEBHOOK_SECRET
        )
    except (ValueError, stripe.SignatureVerificationError) as exc:
        # Unsigned or forged — never act on it.
        print(f"[payments] webhook rejected: {type(exc).__name__}: {exc}")
        raise HTTPException(400, "Invalid webhook signature") from None

    kind = event["type"]
    # StripeObject, not a dict — attribute access with a default, never .get().
    obj = event["data"]["object"]

    if kind == "payment_intent.succeeded":
        metadata = getattr(obj, "metadata", None)
        order_id = getattr(metadata, "order_id", None) if metadata is not None else None
        intent_id = getattr(obj, "id", None)
        amount = getattr(obj, "amount", None)
        print(f"[payments] succeeded intent={intent_id} order={order_id} amount={amount}")

        if order_id:
            recorded = await _order_exists(order_id)
            if recorded is False:
                # Grep for "ORPHANED CHARGE" in the Render logs.
                print(
                    f"[payments] ORPHANED CHARGE intent={intent_id} order={order_id} "
                    f"amount={amount} — money taken with no order row. Re-check before "
                    f"refunding; the app's POST /orders may still be in flight."
                )
    elif kind == "payment_intent.payment_failed":
        last_error = getattr(obj, "last_payment_error", None)
        reason = getattr(last_error, "message", "unknown") if last_error is not None else "unknown"
        print(f"[payments] failed intent={getattr(obj, 'id', None)} reason={reason}")

    return {"received": True}
