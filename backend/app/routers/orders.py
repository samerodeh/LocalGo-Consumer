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

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..auth import require_user
from ..postgrest import REST_URL, client, headers
from .notify import NotifyBody, send_notification

router = APIRouter()

ETA_MINUTES = 45

round2 = lambda n: round(n * 100) / 100  # noqa: E731


def _require_supabase() -> None:
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "Supabase is not configured on the backend")


async def _require_driver(authorization: str | None) -> tuple[str, str]:
    bearer, uid = await require_user(authorization)
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
    id: uuid.UUID | None = None
    restaurant_name: str = Field(min_length=1, max_length=200)
    restaurant_address: str = ""
    customer_name: str = "LocalGO Customer"
    customer_id: str | None = None
    dropoff_address: str
    latitude: float
    longitude: float
    delivery_instructions: str = Field(default="", max_length=2000)
    delivery_preference: Literal["Leave at door", "Meet at door"] | None = None
    entry_code: str = Field(default="", max_length=100)
    subtotal: float = Field(ge=0, le=2000, allow_inf_nan=False)
    delivery_fee: float = Field(ge=0, le=2000, allow_inf_nan=False)
    tip: float = Field(ge=0, le=2000, allow_inf_nan=False)
    total: float = Field(ge=0, le=2000, allow_inf_nan=False)
    items: list[OrderItem] = Field(min_length=1, max_length=100)


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
    # Match the consumer's existing 3 km service area; never trust its UI gate.
    lat, lon = math.radians(body.latitude), math.radians(body.longitude)
    center_lat, center_lon = math.radians(45.496339), math.radians(-73.578666)
    h = math.sin((lat-center_lat)/2)**2 + math.cos(lat)*math.cos(center_lat)*math.sin((lon-center_lon)/2)**2
    if 6371 * 2 * math.asin(math.sqrt(min(1, h))) > 3:
        return "The delivery address is outside our service area."
    return None


@router.post("/orders")
async def place_order(body: PlaceOrderBody, authorization: str | None = Header(default=None)):
    _require_supabase()
    bearer, customer_id = await require_user(authorization)
    if not config.ALLOW_DEMO_ORDERS:
        raise HTTPException(503, "Ordering is unavailable until verified checkout is configured")
    if body.customer_id and body.customer_id != customer_id:
        raise HTTPException(403, "Orders must belong to the signed-in customer")

    problem = _delivery_location_problem(body)
    if problem:
        raise HTTPException(422, problem)

    order_id = str(body.id or uuid.uuid4())
    row: dict[str, Any] = {
        "id": order_id,
        "order_number": f"#LG-{str(int(time.time() * 1000))[-4:]}",
        "restaurant_name": body.restaurant_name,
        "restaurant_address": body.restaurant_address,
        "customer_name": body.customer_name,
        "customer_id": customer_id,
        "dropoff_address": body.dropoff_address.strip(),
        "item_count": sum(i.quantity for i in body.items),
        "order_total": round2(body.total),
        "distance_km": 0,  # Unknown route distance; the feed returns null, never 0 km.
        "dropoff_latitude": body.latitude,
        "dropoff_longitude": body.longitude,
        "delivery_instructions": body.delivery_instructions.strip(),
        "delivery_preference": body.delivery_preference,
        "entry_code": body.entry_code.strip(),
        "driver_pay_cents": config.DRIVER_GUARANTEED_PAY_CENTS + round(body.tip * 100),
        "driver_tip_cents": round(body.tip * 100),
        "status": "available",
        "items": [f"{i.quantity}× {i.name}" for i in body.items],
    }

    res = await client.post(
        f"{REST_URL}/orders",
        headers=headers(bearer, prefer="return=minimal"),
        json=row,
    )
    if res.status_code not in (200, 201):
        print(f"[orders] insert failed {res.status_code} {res.text[:300]}")
        raise HTTPException(502, "Could not publish the order to dispatch")

    # Alert the drivers — best-effort, never fails the order.
    try:
        await send_notification(NotifyBody(orderId=order_id, kind="new_order"))
    except Exception as exc:  # noqa: BLE001
        print(f"[orders] new_order notify failed: {exc}")

    return {"id": order_id}


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
    status: Literal["accepted", "picked_up", "delivered", "declined"]
    # Proof photo URL (order-photos bucket): the order at pickup, or dropped at
    # the customer's location. Optional so 'accepted'/'declined' can omit it.
    photo_url: str | None = Field(default=None, max_length=2048)
    verified_items: list[int] | None = Field(default=None, max_length=100)


# Which customer-facing push fires for each driver status change, and which
# shared-orders columns mirror it so the customer's realtime feed sees progress.
_STATUS_NOTIFY = {"picked_up": "order_picked_up", "delivered": "order_delivered"}


async def _mirror_status_to_order(
    order_id: str, status: str, now: str, photo_url: str | None, bearer: str, current_status: str
) -> None:
    """Persist customer-visible progress using the assigned driver's RLS.

    A missing service-role key must not silently stop customer tracking.
    """
    patch: dict[str, Any] = {"delivery_status": status}
    if status == "picked_up":
        patch["picked_up_at"] = now
        if photo_url:
            patch["pickup_photo_url"] = photo_url
    elif status == "delivered":
        patch["delivered_at"] = now
        if photo_url:
            patch["dropoff_photo_url"] = photo_url
    res = await client.patch(
        f"{REST_URL}/orders",
        headers=headers(bearer, prefer="return=representation"),
        params={"id": f"eq.{order_id}", "delivery_status": f"eq.{current_status}"},
        json=patch,
    )
    if res.status_code != 200:
        raise HTTPException(502, "Could not publish delivery progress to the customer")
    if not res.json():
        raise HTTPException(502, "Delivery progress was not saved")


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
        permitted = {"accepted": {"accepted", "picked_up"}, "picked_up": {"picked_up", "delivered"}, "delivered": {"delivered"}}
        if body.status not in permitted.get(current, set()):
            raise HTTPException(409, "Invalid delivery status transition")
        if body.status == "picked_up":
            items = order.get("items") or []
            if not items or body.verified_items is None or sorted(body.verified_items) != list(range(len(items))):
                raise HTTPException(422, "Verify every pickup item before confirming")
        if body.status == "delivered" and (not body.photo_url or not body.photo_url.startswith(("https://", "http://"))):
            raise HTTPException(422, "A successfully uploaded drop-off photo is required")
        if body.status == current:
            return {"ok": True, "updatedAt": now}
    if body.status in ("picked_up", "delivered"):
        await _mirror_status_to_order(order_id, body.status, now, body.photo_url, bearer, current)
    await _upsert_overlay(bearer, driver_id, order_id, body.status, now)

    if body.status in ("picked_up", "delivered"):
        kind = _STATUS_NOTIFY[body.status]
        try:
            await send_notification(NotifyBody(orderId=order_id, kind=kind))  # type: ignore[arg-type]
        except Exception as exc:  # noqa: BLE001
            print(f"[orders] {kind} notify failed: {exc}")

    return {"ok": True, "updatedAt": now}

