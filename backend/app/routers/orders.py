"""Order dispatch + driver feed — the FastAPI home of what used to be
client-side TypeScript backend logic (the consumer's `dispatch.ts` insert and
the driver's `useOrderFeed.ts` fetch/claim/status writes).

Consumer side: POST /orders validates the delivery location server-side (the
same rule the app enforces at checkout — no order without a real, geocoded
dropoff), computes the dispatch economics, and inserts the row with the anon
key. NOTE: the insert deliberately never chains a RETURNING/select — the anon
role has INSERT but no SELECT on `orders`, and PostgREST would reject the
whole statement (42501) otherwise; ids are generated here instead.

Driver side: every endpoint forwards the driver's own Supabase Auth JWT to
PostgREST, so the schema's RLS policies (broadcast read, atomic claim,
own-overlay writes) apply exactly as before.
"""

import math
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

import stripe
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..mailer import customer_email, send_pickup_photo_email
from ..postgrest import REST_URL, bearer_from, client, headers, jwt_sub
from .notify import NotifyBody, send_notification
from ..auth import require_customer
from ..cart.checkout import CheckoutRepository
from ..cart.models import CartError
from ..cart.payment_binding import verify_intent

router = APIRouter()

ETA_MINUTES = 45

round2 = lambda n: round(n * 100) / 100  # noqa: E731


def _require_supabase() -> None:
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "Supabase is not configured on the backend")


async def _require_driver(authorization: str | None) -> tuple[str, str]:
    session = await require_customer(authorization)
    bearer, uid = session.bearer, str(session.user_id)
    response = await client.get(
        f"{REST_URL}/approved_drivers", headers=headers(bearer),
        params={"id": f"eq.{uid}", "select": "id", "limit": "1"},
    )
    if response.status_code != 200:
        raise HTTPException(503, "Driver authorization is unavailable")
    if not response.json():
        raise HTTPException(403, "An approved driver account is required")
    return bearer, uid


class OrderItem(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    quantity: int = Field(ge=1, le=99)


class PlaceOrderBody(BaseModel):
    id: str | None = None
    # The Stripe PaymentIntent that paid for this order. Required whenever
    # payments are configured — see _verify_payment. Optional only so demo mode
    # (no Stripe keys) keeps working exactly as before.
    payment_intent_id: str | None = None
    restaurant_name: str = Field(min_length=1, max_length=200)
    restaurant_address: str = ""
    customer_name: str = "LocalGO Customer"
    customer_id: str | None = None
    dropoff_address: str
    latitude: float
    longitude: float
    subtotal: float = Field(ge=0)
    delivery_fee: float = Field(ge=0)
    tip: float = Field(ge=0)
    total: float = Field(ge=0)
    delivery_instructions: str = Field(default="", max_length=2000)
    delivery_preference: Literal["Leave at door", "Meet at door"] | None = None
    entry_code: str = Field(default="", max_length=100)
    items: list[OrderItem] = Field(min_length=1)


def _delivery_location_problem(body: PlaceOrderBody) -> str | None:
    """Server-side twin of the app's src/lib/deliveryLocation.ts."""
    if len(body.dropoff_address.strip()) < 4:
        return "A delivery address is required to place an order."
    if not (math.isfinite(body.latitude) and math.isfinite(body.longitude)):
        return "The delivery address has no verified location."
    if body.latitude == 0 and body.longitude == 0:
        return "The delivery address has no verified location."
    if abs(body.latitude) > 90 or abs(body.longitude) > 180:
        return "The delivery address location is invalid."
    return None


def _verify_payment(order_id: str, body: PlaceOrderBody, details: dict | None = None) -> float | None:
    """Confirm this order was actually paid for, and return the charged total.

    Returns the amount Stripe really captured, in dollars — deliberately NOT
    `body.total`, which is client-controlled. Returns None when Stripe isn't
    configured at all, which leaves demo mode behaving as it always has.

    Raises rather than returns on every failure: an unpaid order must not reach
    the driver feed.
    """
    if not config.STRIPE_CONFIGURED:
        return None

    if not body.payment_intent_id:
        raise HTTPException(402, "This order has no payment attached.")

    stripe.api_key = config.STRIPE_SECRET_KEY
    try:
        intent = stripe.PaymentIntent.retrieve(body.payment_intent_id)
    except stripe.StripeError as exc:
        print(f"[orders] intent lookup failed: {type(exc).__name__}: {exc}")
        raise HTTPException(402, "That payment could not be verified.") from None

    if intent.status != "succeeded":
        raise HTTPException(402, f"That payment did not complete (status: {intent.status}).")

    # Binds one intent to one order. Without this, a single successful charge
    # could be replayed to create unlimited orders.
    #
    # NOTE: intent.metadata is a StripeObject, NOT a dict — calling .get() on it
    # raises AttributeError rather than returning None, which would turn every
    # real payment into a 500. Convert before touching it.
    raw_metadata = intent.metadata
    if raw_metadata is None:
        metadata: dict[str, Any] = {}
    elif isinstance(raw_metadata, dict):
        metadata = raw_metadata
    else:
        metadata = raw_metadata.to_dict()

    if metadata.get("app") == "localgo-server-cart":
        raise HTTPException(503, "Server-cart payments must be reconciled with server cart checkout enabled.")

    if metadata.get("order_id") != order_id:
        raise HTTPException(402, "That payment belongs to a different order.")

    if details is not None:
        try:
            tip = int(metadata["tip_cents"])
            if 0 <= tip <= intent.amount:
                details["tip_cents"] = tip
        except (KeyError, TypeError, ValueError):
            pass  # A legacy payment without a verified tip keeps earnings unknown.
    return round2(intent.amount / 100)


@router.post("/orders")
async def place_order(body: PlaceOrderBody, authorization: str | None = Header(default=None)):
    _require_supabase()

    problem = _delivery_location_problem(body)
    if problem:
        raise HTTPException(422, problem)

    customer = await require_customer(authorization)
    if not config.SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(503, "Verified dispatch is not configured")
    order_id = body.id or str(uuid.uuid4())
    payment_details: dict[str, int] = {}


    # Money gate. Runs before anything is written, so a failed or forged
    # payment never produces a row the drivers can see.
    checkout = None
    checkout_repository = None
    if config.SERVER_CART_ENABLED:
        if not config.STRIPE_CONFIGURED or not body.id or not body.payment_intent_id:
            raise HTTPException(503, "Signed-in server-cart checkout requires a verified payment and stable order ID.")
        customer = await require_customer(authorization)
        checkout_repository = CheckoutRepository()
        try:
            checkout = await checkout_repository.get(customer.user_id, uuid.UUID(order_id))
        except ValueError:
            raise HTTPException(422, "order id must be a UUID") from None
        except CartError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from None
        if checkout.payment_intent_id != body.payment_intent_id or checkout.status not in ("pending", "consumed"):
            raise HTTPException(409, "This payment is not attached to an active checkout.")
        stripe.api_key = config.STRIPE_SECRET_KEY
        try:
            intent = stripe.PaymentIntent.retrieve(body.payment_intent_id)
        except stripe.StripeError:
            raise HTTPException(502, "Could not verify checkout payment.") from None
        verify_intent(intent, checkout, paid=True)
        quote = checkout.priced()
        merchants = {"al-taib": ("Al Taib", "2125 Guy St, Montreal"),
                     "chateau-kabab": ("Château Kabab", "2140 Rue Guy, Montreal, QC")}
        merchant = merchants.get(checkout.cart.merchant_id)
        if merchant is None:
            raise HTTPException(409, "Checkout restaurant is unavailable.")
        body = body.model_copy(update={"customer_id": str(customer.user_id),
            "restaurant_name": merchant[0], "restaurant_address": merchant[1],
            "items": [OrderItem(name=line.name, quantity=line.quantity) for line in quote.lines]})
        charged_total = quote.total_cents / 100
        payment_details["tip_cents"] = quote.tip_cents
    else:
        if body.customer_id and body.customer_id != str(customer.user_id):
            raise HTTPException(403, "Orders must belong to the signed-in customer")
        body = body.model_copy(update={"customer_id": str(customer.user_id)})
        charged_total = _verify_payment(order_id, body, payment_details)
        if not config.STRIPE_CONFIGURED:
            payment_details["tip_cents"] = round(body.tip * 100)


    order_number = f"#LG-{str(int(time.time() * 1000))[-4:]}"

    row: dict[str, Any] = {
        "id": order_id,
        "order_number": order_number,
        "restaurant_name": body.restaurant_name,
        "restaurant_address": body.restaurant_address,
        "customer_name": body.customer_name,
        "customer_id": body.customer_id,
        "payment_intent_id": body.payment_intent_id,
        "dropoff_address": body.dropoff_address.strip(),
        "item_count": sum(i.quantity for i in body.items),
        # What Stripe actually took, when there was a charge. body.total is
        # only a fallback for demo mode.
        "order_total": charged_total if charged_total is not None else round2(body.total),
        # No road-route estimate is available; zero is stored as unknown and mapped to null.
        "distance_km": 0,
        "dropoff_latitude": body.latitude,
        "dropoff_longitude": body.longitude,
        "delivery_instructions": body.delivery_instructions.strip(),
        "delivery_preference": body.delivery_preference,
        "entry_code": body.entry_code.strip(),
        "driver_pay_cents": 500 + payment_details["tip_cents"] if "tip_cents" in payment_details else None,
        "driver_tip_cents": payment_details.get("tip_cents", 0),
        "status": "available",
        "items": [f"{i.quantity}× {i.name}" for i in body.items],
    }

    res = await client.post(
        f"{REST_URL}/orders",
        headers=headers(service=True, prefer="return=minimal"),
        json=row,
    )
    if res.status_code == 409:
        # Primary-key collision on the client-generated id: this exact order was
        # already published. The app retries dispatch after a successful charge
        # (see placeOrder), so treat a replay as success rather than telling a
        # paid customer their order failed.
        #
        # No order_number: the row already has one from the first attempt, and
        # the anon role can't read it back (see the module docstring). The app
        # picks it up on its next status sync.
        if checkout is not None:
            try:
                await checkout_repository.update(checkout, "consume", payment_id=body.payment_intent_id)
            except CartError as exc:
                raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from None
        print(f"[orders] duplicate publish ignored for {order_id}")
        return {"id": order_id, "duplicate": True}
    if res.status_code not in (200, 201):
        print(f"[orders] insert failed {res.status_code} {res.text[:300]}")
        raise HTTPException(502, "Could not publish the order to dispatch")

    if checkout is not None:
        try:
            await checkout_repository.update(checkout, "consume", payment_id=body.payment_intent_id)
        except CartError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from None

    # Alert the drivers — best-effort, never fails the order.
    try:
        await send_notification(NotifyBody(orderId=order_id, kind="new_order"))
    except Exception as exc:  # noqa: BLE001
        print(f"[orders] new_order notify failed: {exc}")

    # order_number is returned so the app can show the customer the same
    # reference the drivers and every push notification use.
    return {"id": order_id, "order_number": order_number}


def _map_row(row: dict[str, Any], overlay: dict[str, Any] | None) -> dict[str, Any]:
    """snake_case DB row -> the driver app's camelCase DeliveryOrder."""
    return {
        "id": row["id"],
        "orderNumber": row["order_number"],
        "restaurantName": row["restaurant_name"],
        "restaurantAddress": row["restaurant_address"],
        "customerName": row["customer_name"],
        "dropoffAddress": row["dropoff_address"],
        "itemCount": row["item_count"],
        "orderTotal": float(row["order_total"]),
        "distanceKm": float(row["distance_km"]) if row.get("distance_km") and float(row["distance_km"]) > 0 else None,
        "dropoffLatitude": row.get("dropoff_latitude"),
        "dropoffLongitude": row.get("dropoff_longitude"),
        "deliveryInstructions": row.get("delivery_instructions") or "",
        "deliveryPreference": row.get("delivery_preference"),
        "entryCode": row.get("entry_code") or "",
        "pickupNotes": row.get("pickup_notes") or "",
        "guaranteedPayCents": row.get("driver_pay_cents"),
        "tipCents": row.get("driver_tip_cents", 0),
        "acceptedAt": row.get("accepted_at"),
        "deliveredAt": row.get("delivered_at"),
        "status": (row.get("delivery_status") or (overlay["status"] if overlay else "accepted"))
        if row.get("accepted_by") else (overlay["status"] if overlay else "available"),
        "statusUpdatedAt": overlay["updated_at"] if overlay else None,
        "acceptedBy": row.get("accepted_by"),
        "customerId": row.get("customer_id"),
        "createdAt": row["created_at"],
        "items": row.get("items") or [],
    }


@router.get("/orders/feed")
async def order_feed(authorization: str | None = Header(default=None)):
    _require_supabase()
    bearer, driver_id = await _require_driver(authorization)
    auth = headers(bearer)

    orders_res = await client.get(
        f"{REST_URL}/orders",
        headers=auth,
        params={
            "select": "*",
            # Only unclaimed orders plus the ones this driver claimed.
            "or": f"(accepted_by.is.null,accepted_by.eq.{driver_id})",
            "order": "created_at.desc",
            "limit": "100",
        },
    )
    if orders_res.status_code != 200:
        print(f"[orders] feed fetch failed {orders_res.status_code} {orders_res.text[:300]}")
        raise HTTPException(502, "Could not fetch the order feed")

    overlay_res = await client.get(
        f"{REST_URL}/driver_orders",
        headers=auth,
        params={"select": "order_id,status,updated_at", "driver_id": f"eq.{driver_id}"},
    )
    if overlay_res.status_code != 200:
        raise HTTPException(502, "Could not fetch delivery progress")
    overlay_rows = overlay_res.json()
    overlay = {r["order_id"]: r for r in overlay_rows}

    return {"orders": [_map_row(r, overlay.get(r["id"])) for r in orders_res.json()]}


@router.post("/orders/{order_id}/accept")
async def accept_order(order_id: uuid.UUID, authorization: str | None = Header(default=None)):
    """Atomic claim: stamps accepted_by only while the order is unclaimed.
    Losing the race returns 409 so the app can drop the card locally."""
    _require_supabase()
    order_id = str(order_id)
    bearer, driver_id = await _require_driver(authorization)
    now = datetime.now(timezone.utc).isoformat()

    res = await client.post(
        f"{REST_URL}/rpc/driver_accept_offer", headers=headers(bearer),
        json={"p_order_id": order_id},
    )
    if res.status_code != 200:
        raise HTTPException(502, "Could not accept this offer")
    claimed = res.json()
    if not claimed:
        raise HTTPException(409, "Offer expired, driver offline, or another delivery is active")

    # Let the customer know — unlocks their "Chat with driver" button.
    try:
        await send_notification(NotifyBody(orderId=order_id, kind="order_accepted"))
    except Exception as exc:  # noqa: BLE001
        print(f"[orders] order_accepted notify failed: {exc}")

    return {"ok": True, "acceptedAt": claimed.get("acceptedAt", now)}


class StatusBody(BaseModel):
    status: Literal["accepted", "picked_up", "nearby", "arrived", "delivered", "declined"]
    # Proof photo URL (order-photos bucket): the order at pickup, or dropped at
    # the customer's location. Optional so 'accepted'/'declined' can omit it.
    photo_url: str | None = Field(default=None, max_length=2048)
    verified_items: list[int] | None = Field(default=None, max_length=100)


# Which customer-facing push fires for each driver status change. Membership in
# this map is also what marks a status as customer-visible: those are exactly
# the ones mirrored onto the shared orders row. 'declined' is deliberately
# absent — a driver passing on an order is private to that driver, and the
# order simply stays available to everyone else.
_STATUS_NOTIFY = {
    "picked_up": "order_picked_up",
    "nearby": "order_nearby",
    "arrived": "order_arrived",
    "delivered": "order_delivered",
}

async def _email_pickup_photo(order_id: str) -> None:
    """Mail the customer the photo their driver just took of the order.

    Runs only at pickup, and only with both mail and the service-role key
    configured. Reads the order back with the service role because the photo URL
    was written a moment ago by the mirror and the customer's address lives in
    Auth, not in any table we can join.
    """
    if not config.EMAIL_CONFIGURED or not config.SUPABASE_SERVICE_ROLE_KEY:
        return

    res = await client.get(
        f"{REST_URL}/orders",
        headers=headers(service=True),
        params={
            "id": f"eq.{order_id}",
            "select": "id,order_number,restaurant_name,customer_id,eta_minutes,pickup_photo_url",
            "limit": "1",
        },
    )
    rows = res.json() if res.status_code == 200 else []
    if not rows:
        print(f"[orders] pickup email skipped: order {order_id} not readable")
        return
    order = rows[0]
    if not order.get("customer_id"):
        return

    to_email = await customer_email(order["customer_id"])
    if not to_email:
        print(f"[orders] pickup email skipped: no address for order {order_id}")
        return

    await send_pickup_photo_email(to_email, order, order.get("pickup_photo_url"))


@router.post("/orders/{order_id}/status")
async def update_status(
    order_id: uuid.UUID,
    body: StatusBody,
    authorization: str | None = Header(default=None),
):
    """Everything except the accept-claim (decline / picked_up / delivered).
    Writes the driver's private overlay row, mirrors forward progress onto the
    shared orders row so the customer can follow it, and pushes the customer a
    'on the way' / 'arrived' notification."""
    _require_supabase()
    order_id = str(order_id)
    bearer, driver_id = await _require_driver(authorization)
    now = datetime.now(timezone.utc).isoformat()
    # Check ownership before ANY overlay write or service-role status update.
    response = await client.get(
        f"{REST_URL}/orders", headers=headers(bearer),
        params={"id": f"eq.{order_id}", "select": "accepted_by,delivery_status,items", "limit": "1"},
    )
    if response.status_code != 200:
        raise HTTPException(502, "Could not verify order ownership")
    rows = response.json()
    if not rows:
        raise HTTPException(404, "Order not found")
    order = rows[0]
    if body.status == "declined":
        if order.get("accepted_by") is not None:
            raise HTTPException(409, "A claimed order cannot be declined")
        declined = await client.post(f"{REST_URL}/rpc/driver_decline_offer", headers=headers(bearer), json={"p_order_id": order_id})
        if declined.status_code != 200:
            raise HTTPException(502, "Could not decline this offer")
        if not declined.json():
            raise HTTPException(409, "This offer is no longer available")
        return {"ok": True, "updatedAt": now}
    else:
        if order.get("accepted_by") != driver_id:
            raise HTTPException(403, "Only the assigned driver can update this order")
        current = order.get("delivery_status", "available")
        permitted = {"accepted": {"accepted", "picked_up"}, "picked_up": {"picked_up", "nearby", "arrived", "delivered"}, "nearby": {"nearby", "arrived", "delivered"}, "arrived": {"arrived", "delivered"}, "delivered": {"delivered"}}
        if body.status not in permitted.get(current, set()):
            raise HTTPException(409, "Invalid delivery status transition")
        if body.status == "picked_up":
            items = order.get("items") or []
            if not items or body.verified_items is None or sorted(body.verified_items) != list(range(len(items))):
                raise HTTPException(422, "Verify every pickup item before confirming")
        if body.status == "delivered" and (not body.photo_url or not body.photo_url.startswith(("https://", "http://"))):
            raise HTTPException(422, "A successfully uploaded drop-off photo is required")
    result = await client.post(
        f"{REST_URL}/rpc/driver_update_status", headers=headers(bearer),
        json={"p_order_id": order_id, "p_status": body.status,
              "p_photo_url": body.photo_url, "p_verified_items": body.verified_items},
    )
    if result.status_code != 200:
        error = result.json()
        code = error.get("code") if isinstance(error, dict) else None
        if code == "42501":
            raise HTTPException(403, "Only the assigned approved driver can update this order")
        if code == "22023":
            raise HTTPException(422, "Verify the delivery stage, every pickup item, and the uploaded proof photo")
        raise HTTPException(502, "Delivery progress was not saved")
    saved = result.json()
    if not saved.get("changed"):
        return {"ok": True, "updatedAt": saved["updatedAt"]}
    if body.status in _STATUS_NOTIFY:
        try:
            await send_notification(NotifyBody(orderId=order_id, kind=_STATUS_NOTIFY[body.status]))
        except Exception as exc:
            print(f"[orders] status notification unavailable: {type(exc).__name__}")

    if body.status == "picked_up":
        try:
            await _email_pickup_photo(order_id)
        except Exception as exc:
            print(f"[orders] pickup receipt unavailable: {type(exc).__name__}")

    return {"ok": True, "updatedAt": saved["updatedAt"]}


@router.get("/orders/history")
async def order_history(
    scope: Literal["today", "all"] = "all",
    authorization: str | None = Header(default=None),
):
    """Every delivery this driver has completed — today's, or all time.

    Reads `driver_orders` with the driver's OWN token: its self-only RLS
    policies are what scope the result to this driver. Deliberately not filtered
    by the unverified `sub` from the JWT (see postgrest.jwt_sub) — that would be
    forgeable, and this endpoint returns customer names and addresses.

    The `orders(...)` embed relies on the driver_orders → orders foreign key.
    """
    _require_supabase()
    bearer, _ = await _require_driver(authorization)

    params: dict[str, str] = {
        "select": "order_id,status,updated_at,orders(*)",
        "status": "eq.delivered",
        "order": "updated_at.desc",
        "limit": "500",
    }
    if scope == "today":
        # Local midnight would need the driver's timezone, which the backend
        # doesn't know; the app re-filters to the device's own day boundary.
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        params["updated_at"] = f"gte.{start.isoformat()}"

    res = await client.get(f"{REST_URL}/driver_orders", headers=headers(bearer), params=params)
    if res.status_code != 200:
        print(f"[orders] history fetch failed {res.status_code} {res.text[:300]}")
        raise HTTPException(502, "Could not fetch your delivery history")

    deliveries = []
    for row in res.json():
        order = row.get("orders")
        if not order:
            # The order row was deleted (or is unreadable) — skip rather than
            # emit a half-empty card.
            continue
        mapped = _map_row(order, {"status": row["status"], "updated_at": row["updated_at"]})
        mapped["deliveredAt"] = row["updated_at"]
        deliveries.append(mapped)

    return {"orders": deliveries}
