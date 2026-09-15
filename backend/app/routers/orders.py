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

router = APIRouter()

ETA_MINUTES = 45

round2 = lambda n: round(n * 100) / 100  # noqa: E731


def _require_supabase() -> None:
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "Supabase is not configured on the backend")


def _require_driver(authorization: str | None) -> tuple[str, str]:
    """Returns (bearer, driver uid) or raises 401. The uid is only a query
    filter — RLS on the forwarded token is the real enforcement."""
    bearer = bearer_from(authorization)
    sub = jwt_sub(bearer)
    if not bearer or not sub:
        raise HTTPException(401, "A signed-in driver token is required")
    return bearer, sub


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


def _verify_payment(order_id: str, body: PlaceOrderBody) -> float | None:
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

    if metadata.get("order_id") != order_id:
        raise HTTPException(402, "That payment belongs to a different order.")

    return round2(intent.amount / 100)


@router.post("/orders")
async def place_order(body: PlaceOrderBody):
    _require_supabase()

    problem = _delivery_location_problem(body)
    if problem:
        raise HTTPException(422, problem)

    order_id = body.id or str(uuid.uuid4())

    # Money gate. Runs before anything is written, so a failed or forged
    # payment never produces a row the drivers can see.
    charged_total = _verify_payment(order_id, body)

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
        # Placeholder — no routing in scope yet (coords are validated above
        # but the schema has no dropoff lat/lng columns).
        "distance_km": 2.5,
        "status": "available",
        "items": [f"{i.quantity}× {i.name}" for i in body.items],
    }

    res = await client.post(
        f"{REST_URL}/orders",
        headers=headers(prefer="return=minimal"),
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
        print(f"[orders] duplicate publish ignored for {order_id}")
        return {"id": order_id, "duplicate": True}
    if res.status_code not in (200, 201):
        print(f"[orders] insert failed {res.status_code} {res.text[:300]}")
        raise HTTPException(502, "Could not publish the order to dispatch")

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
        "distanceKm": float(row["distance_km"]),
        "status": overlay["status"] if overlay else "available",
        "statusUpdatedAt": overlay["updated_at"] if overlay else None,
        "acceptedBy": row.get("accepted_by"),
        "customerId": row.get("customer_id"),
        "createdAt": row["created_at"],
        "items": row.get("items") or [],
    }


@router.get("/orders/feed")
async def order_feed(authorization: str | None = Header(default=None)):
    _require_supabase()
    bearer, driver_id = _require_driver(authorization)
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
    overlay_rows = overlay_res.json() if overlay_res.status_code == 200 else []
    overlay = {r["order_id"]: r for r in overlay_rows}

    return {"orders": [_map_row(r, overlay.get(r["id"])) for r in orders_res.json()]}


async def _upsert_overlay(bearer: str, driver_id: str, order_id: str, status: str, now: str) -> None:
    res = await client.post(
        f"{REST_URL}/driver_orders",
        headers=headers(bearer, prefer="resolution=merge-duplicates,return=minimal"),
        params={"on_conflict": "driver_id,order_id"},
        json={"driver_id": driver_id, "order_id": order_id, "status": status, "updated_at": now},
    )
    if res.status_code not in (200, 201, 204):
        print(f"[orders] driver_orders upsert failed {res.status_code} {res.text[:300]}")
        raise HTTPException(502, "Could not save the order status")


@router.post("/orders/{order_id}/accept")
async def accept_order(order_id: str, authorization: str | None = Header(default=None)):
    """Atomic claim: stamps accepted_by only while the order is unclaimed.
    Losing the race returns 409 so the app can drop the card locally."""
    _require_supabase()
    bearer, driver_id = _require_driver(authorization)
    now = datetime.now(timezone.utc).isoformat()

    res = await client.patch(
        f"{REST_URL}/orders",
        headers=headers(bearer, prefer="return=representation"),
        params={"id": f"eq.{order_id}", "accepted_by": "is.null"},
        json={
            "accepted_by": driver_id,
            "accepted_at": now,
            "eta_minutes": ETA_MINUTES,
            "delivery_status": "accepted",
        },
    )
    if res.status_code not in (200, 201):
        print(f"[orders] claim failed {res.status_code} {res.text[:300]}")
        raise HTTPException(502, "Could not claim the order")
    if not res.json():
        raise HTTPException(409, "Another driver already took this order")

    await _upsert_overlay(bearer, driver_id, order_id, "accepted", now)

    # Let the customer know — unlocks their "Chat with driver" button.
    try:
        await send_notification(NotifyBody(orderId=order_id, kind="order_accepted"))
    except Exception as exc:  # noqa: BLE001
        print(f"[orders] order_accepted notify failed: {exc}")

    return {"ok": True, "etaMinutes": ETA_MINUTES, "acceptedAt": now}


class StatusBody(BaseModel):
    status: Literal["accepted", "picked_up", "nearby", "arrived", "delivered", "declined"]
    # Proof photo URL (order-photos bucket): the order at pickup, or dropped at
    # the customer's location. Optional so the statuses without a camera step
    # ('accepted'/'nearby'/'arrived'/'declined') can omit it.
    photo_url: str | None = None


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

# The column stamped with `now` for each milestone, so the customer's history
# can show when each beat happened rather than just where the order got to.
_STATUS_TIMESTAMP = {
    "picked_up": "picked_up_at",
    "nearby": "nearby_at",
    "arrived": "arrived_at",
    "delivered": "delivered_at",
}

# Which photo column a proof shot belongs in. Only the two ends of the trip
# have a camera step; nearby/arrived are one-tap.
_STATUS_PHOTO_COLUMN = {"picked_up": "pickup_photo_url", "delivered": "dropoff_photo_url"}


async def _mirror_status_to_order(
    order_id: str, status: str, now: str, photo_url: str | None
) -> None:
    """Copy a driver's progress onto the shared orders row (service role, so it
    lands regardless of the driver's own RLS) — this is what the customer, who
    can't read driver_orders, actually subscribes to."""
    if not config.SUPABASE_SERVICE_ROLE_KEY:
        return
    patch: dict[str, Any] = {"delivery_status": status}
    stamp = _STATUS_TIMESTAMP.get(status)
    if stamp:
        patch[stamp] = now
    photo_column = _STATUS_PHOTO_COLUMN.get(status)
    if photo_column and photo_url:
        patch[photo_column] = photo_url
    res = await client.patch(
        f"{REST_URL}/orders",
        headers=headers(service=True, prefer="return=minimal"),
        params={"id": f"eq.{order_id}"},
        json=patch,
    )
    if res.status_code not in (200, 204):
        print(f"[orders] status mirror failed {res.status_code} {res.text[:300]}")


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
    order_id: str,
    body: StatusBody,
    authorization: str | None = Header(default=None),
):
    """Everything except the accept-claim (decline / picked_up / nearby /
    arrived / delivered). Writes the driver's private overlay row, mirrors
    forward progress onto the shared orders row so the customer can follow it,
    and pushes the customer the milestone notification for that step.

    The four customer-visible milestones are one narrative — 'picked up' →
    'almost there' → 'here' → 'delivered' — so they all take the same path;
    only 'declined' stays private to the driver."""
    _require_supabase()
    bearer, driver_id = _require_driver(authorization)
    now = datetime.now(timezone.utc).isoformat()
    await _upsert_overlay(bearer, driver_id, order_id, body.status, now)

    kind = _STATUS_NOTIFY.get(body.status)
    if kind:
        await _mirror_status_to_order(order_id, body.status, now, body.photo_url)
        try:
            await send_notification(NotifyBody(orderId=order_id, kind=kind))  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001
            print(f"[orders] {kind} notify failed: {exc}")

        # Pickup also mails the customer the photo the driver just took. Runs
        # after the mirror so the URL is already on the row, and is best-effort
        # for the same reason the push is: a mail relay being down must never
        # leave a driver unable to advance a delivery they've already made.
        if body.status == "picked_up":
            try:
                await _email_pickup_photo(order_id)
            except Exception as exc:  # noqa: BLE001
                print(f"[orders] pickup email failed: {exc}")

    return {"ok": True, "updatedAt": now}


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
    bearer, _ = _require_driver(authorization)

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
