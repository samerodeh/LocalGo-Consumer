"""Consumer commerce contracts. Prices, promotions and ownership are server authoritative.

The existing /orders dispatch API remains backward compatible. This router adds
quote/checkout, pickup fulfillment, verified-purchase reviews and location sharing.
"""

import asyncio
import json
import uuid
import httpx
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, ConfigDict

from .. import config
from ..auth import require_user
from ..postgrest import REST_URL, client, headers
from .orders import _require_driver
from .notify import NotifyBody, send_notification

router = APIRouter(prefix="/consumer", tags=["Consumer experience"])
MENU = json.loads(
    (Path(__file__).resolve().parent.parent / "data/menu.json").read_text()
)
CATALOG = {(p["merchant_id"], p["product_id"]): p for p in MENU}


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Selection(Contract):
    groupId: str = Field(max_length=100)
    choiceNames: list[str] = Field(max_length=30)


class Line(Contract):
    productId: str = Field(min_length=1, max_length=150)
    quantity: int = Field(ge=1, le=99, strict=True)
    selections: list[Selection] = Field(default_factory=list, max_length=30)
    notes: str = Field(default="", max_length=1000)


class DeliveryAddress(Contract):
    addressLine: str = Field(min_length=4, max_length=500)
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    apartmentSuite: str = Field(default="", max_length=100)
    instructions: str = Field(default="", max_length=2000)
    entryCode: str = Field(default="", max_length=100)
    preference: Literal["Leave at door", "Meet at door"] = "Leave at door"


class QuoteBody(Contract):
    merchantId: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9-]+$")
    mode: Literal["delivery", "pickup"] = "delivery"
    items: list[Line] = Field(min_length=1, max_length=100)
    tipCents: int = Field(default=0, ge=0, le=200000, strict=True)
    promoCode: str | None = Field(
        default=None, max_length=40, pattern=r"^[A-Za-z0-9_-]*$"
    )


class CheckoutBody(QuoteBody):
    id: uuid.UUID
    expectedTotalCents: int = Field(ge=0, le=500000, strict=True)
    address: DeliveryAddress | None = None
    customerName: str = Field(default="LocalGO Customer", min_length=1, max_length=150)


def _service():
    if not config.SUPABASE_CONFIGURED or not config.SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(
            503, "This feature is not available yet. Please try again later."
        )
    return headers(service=True)


async def _get(table, params, *, private=False):
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "The store service is not configured.")
    try:
        res = await client.get(
            f"{REST_URL}/{table}",
            headers=_service() if private else headers(),
            params=params,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            503, "The store service is temporarily unavailable."
        ) from exc
    if res.status_code != 200:
        raise HTTPException(503, "The store service is temporarily unavailable.")
    return res.json()


async def _post(*args, **kwargs):
    try:
        return await client.post(*args, **kwargs)
    except httpx.HTTPError as exc:
        raise HTTPException(
            503,
            "The store service is temporarily unavailable. Retry your existing order.",
        ) from exc


async def merchant_by_id(merchant_id):
    rows = await _get(
        "consumer_merchant_catalog",
        {"id": f"eq.{merchant_id}", "active": "eq.true", "select": "*", "limit": "1"},
    )
    if not rows:
        raise HTTPException(404, "This store is not available.")
    return rows[0]


def price_lines(lines: list[Line], merchant_id: str) -> tuple[int, list[str]]:
    """Validate IDs/options and price every selection from the deployed catalogue."""
    subtotal, summary = 0, []
    for line in lines:
        item = CATALOG.get((merchant_id, line.productId))
        if not item:
            raise HTTPException(
                422, "An item is no longer on this store’s menu. Refresh your bag."
            )
        if line.notes.strip() and not item.get("allows_notes"):
            raise HTTPException(422, "This item does not accept special instructions.")
        groups = {g["id"]: g for g in item.get("option_groups", [])}
        selections = {s.groupId: s.choiceNames for s in line.selections}
        if len(selections) != len(line.selections) or any(
            key not in groups for key in selections
        ):
            raise HTTPException(422, "Invalid item options.")
        unit, chosen = item["price_cents"], []
        for key, group in groups.items():
            names = selections.get(key, [])
            choices = {c["name"]: c for c in group["choices"]}
            cap = group.get("maxSelect", group.get("max_select", 1))
            if (
                len(names) != len(set(names))
                or len(names) > cap
                or (group.get("required") and not names)
                or any(n not in choices for n in names)
            ):
                raise HTTPException(422, f"Please review the {group['title']} options.")
            unit += sum(
                int(
                    choices[n].get(
                        "priceDeltaCents", round(choices[n].get("priceDelta", 0) * 100)
                    )
                )
                for n in names
            )
            chosen.extend(names)
        subtotal += unit * line.quantity
        label = item["name"] + (f" ({', '.join(chosen)})" if chosen else "")
        if line.notes.strip():
            label += f" — {line.notes.strip()}"
        summary.append(f"{line.quantity}× {label}")
    if subtotal > 200000:
        raise HTTPException(422, "This order exceeds the supported order size.")
    return subtotal, summary


def promotion_discount(promo, subtotal, mode, merchant_id, now=None):
    now = now or datetime.now(timezone.utc)
    if (
        not promo.get("active")
        or (
            promo.get("starts_at")
            and datetime.fromisoformat(promo["starts_at"].replace("Z", "+00:00")) > now
        )
        or (
            promo.get("expires_at")
            and datetime.fromisoformat(promo["expires_at"].replace("Z", "+00:00"))
            <= now
        )
    ):
        raise HTTPException(422, "This promotion is not active.")
    if promo.get("merchant_id") and promo["merchant_id"] != merchant_id:
        raise HTTPException(422, "This promotion is for a different store.")
    if promo.get("mode") and promo["mode"] != mode:
        raise HTTPException(422, "This promotion does not apply to this order type.")
    if subtotal < promo["minimum_cents"]:
        raise HTTPException(
            422,
            f"This promotion requires a ${promo['minimum_cents'] / 100:.2f} food subtotal.",
        )
    amount = (
        promo["amount"]
        if promo["kind"] == "fixed"
        else subtotal * promo["amount"] // 100
    )
    if promo.get("max_discount_cents") is not None:
        amount = min(amount, promo["max_discount_cents"])
    return min(subtotal, amount)


async def quote_for(body: QuoteBody, uid: str):
    merchant = await merchant_by_id(body.merchantId)
    if body.mode == "pickup" and not merchant["pickup_enabled"]:
        raise HTTPException(422, "This store is not accepting pickup orders.")
    subtotal, summary = price_lines(body.items, body.merchantId)
    code = body.promoCode.upper().strip() if body.promoCode else None
    discount = 0
    if code:
        promos = await _get(
            "consumer_promotion_availability",
            {"code": f"eq.{code}", "select": "*", "limit": "1"},
            private=True,
        )
        if not promos:
            raise HTTPException(422, "That promotion code could not be found.")
        promo = promos[0]
        discount = promotion_discount(promo, subtotal, body.mode, body.merchantId)
        usages = await _get(
            "consumer_promo_customer_usage",
            {
                "code": f"eq.{code}",
                "customer_id": f"eq.{uid}",
                "select": "uses",
                "limit": "1",
            },
            private=True,
        )
        if (
            promo["usage_limit"] is not None
            and promo["redeemed_count"] >= promo["usage_limit"]
        ) or (usages and usages[0]["uses"] >= promo["per_customer_limit"]):
            raise HTTPException(
                422, "This promotion has already reached its usage limit."
            )
    fee = merchant["delivery_fee_cents"] if body.mode == "delivery" else 0
    tip = body.tipCents if body.mode == "delivery" else 0
    quote = dict(
        subtotalCents=subtotal,
        deliveryFeeCents=fee,
        tipCents=tip,
        discountCents=discount,
        totalCents=subtotal + fee + tip - discount,
        promoCode=code,
        currency="CAD",
    )
    return quote, merchant, summary


@router.get("/catalog")
async def catalog():
    rows = await _get(
        "consumer_merchant_catalog",
        {"select": "*", "active": "eq.true", "order": "id.asc", "limit": "200"},
    )
    menu_merchants = {item["merchant_id"] for item in MENU}
    return {
        "merchants": [{**row, "has_menu": row["id"] in menu_merchants} for row in rows],
        "currency": "CAD",
    }


@router.post("/quote")
async def quote(body: QuoteBody, authorization: str | None = Header(default=None)):
    _, uid = await require_user(authorization)
    result, _, _ = await quote_for(body, uid)
    return result


@router.post("/checkout")
async def checkout(
    body: CheckoutBody, authorization: str | None = Header(default=None)
):
    _, uid = await require_user(authorization)
    service = _service()
    # Preserve the existing verified-payment release gate. No simulated charges in production.
    if not config.ALLOW_DEMO_ORDERS:
        raise HTTPException(
            503, "Ordering is unavailable until verified checkout is configured."
        )
    # Idempotency lookup occurs before re-quoting so a retry cannot redeem twice.
    existing = await _get(
        "consumer_receipts",
        {
            "id": f"eq.{body.id}",
            "customer_id": f"eq.{uid}",
            "select": "*",
            "limit": "1",
        },
        private=True,
    )
    if existing:
        return {
            "id": str(body.id),
            "orderNumber": existing[0]["order_number"],
            "quote": existing[0]["quote"],
        }
    result, merchant, summary = await quote_for(body, uid)
    if result["totalCents"] != body.expectedTotalCents:
        raise HTTPException(409, "Your total changed. Review your bag before ordering.")
    if body.mode == "delivery":
        if body.address is None:
            raise HTTPException(422, "Choose a verified delivery address.")
        from ..consumer_rules import valid_delivery_point

        if not valid_delivery_point(body.address.latitude, body.address.longitude):
            raise HTTPException(
                422, "That delivery address is outside our service area."
            )
    row = {
        "id": str(body.id),
        "customer_id": uid,
        "merchant_id": body.merchantId,
        "mode": body.mode,
        "customer_name": body.customerName,
        "address": body.address.model_dump()
        if body.address and body.mode == "delivery"
        else None,
        "quote": result,
        "items": summary,
        "line_items": [line.model_dump() for line in body.items],
    }
    res = await _post(
        f"{REST_URL}/rpc/consumer_checkout", headers=service, json={"p_order": row}
    )
    if res.status_code != 200:
        detail = (
            res.json().get("message", "")
            if res.headers.get("content-type", "").startswith("application/json")
            else ""
        )
        if any(
            word in detail.lower()
            for word in ("promotion", "total changed", "pickup", "store")
        ):
            raise HTTPException(
                409, "The store or promotion changed. Review your bag and try again."
            )
        raise HTTPException(
            503, "Your order could not be saved. Please retry with the same order."
        )
    receipt = res.json()
    if body.mode == "delivery":
        try:
            await send_notification(NotifyBody(orderId=str(body.id), kind="new_order"))
        except Exception:
            pass
    return {
        "id": str(body.id),
        "orderNumber": receipt["order_number"],
        "quote": receipt["quote"],
    }


async def receipt_for(order_id, uid):
    rows = await _get(
        "consumer_receipts",
        {
            "id": f"eq.{order_id}",
            "customer_id": f"eq.{uid}",
            "select": "*",
            "limit": "1",
        },
        private=True,
    )
    if not rows:
        raise HTTPException(404, "Order not found.")
    return rows[0]


async def public_order(receipt, cached=None):
    if cached is None:
        stores = await _get(
            "consumer_merchants",
            {"id": f"eq.{receipt['merchant_id']}", "select": "*", "limit": "1"},
            private=True,
        )
        if not stores:
            raise HTTPException(404, "Store not found.")
        merchant = stores[0]
        status, position = receipt["status"], None
        if receipt["mode"] == "delivery":
            orders = await _get(
                "orders",
                {
                    "id": f"eq.{receipt['id']}",
                    "select": "delivery_status",
                    "limit": "1",
                },
                private=True,
            )
            status = orders[0]["delivery_status"] if orders else status
            locations = await _get(
                "consumer_courier_locations",
                {
                    "order_id": f"eq.{receipt['id']}",
                    "select": "latitude,longitude,updated_at",
                    "limit": "1",
                },
                private=True,
            )
            if locations and status in ("accepted", "picked_up"):
                p = locations[0]
                position = {
                    "latitude": p["latitude"],
                    "longitude": p["longitude"],
                    "updatedAt": p["updated_at"],
                }
    else:
        merchant = cached["merchants"][receipt["merchant_id"]]
        dispatch = cached["dispatch"].get(receipt["id"], {})
        status = (
            dispatch.get("delivery_status", receipt["status"])
            if receipt["mode"] == "delivery"
            else receipt["status"]
        )
        location = cached["locations"].get(receipt["id"])
        position = (
            {
                "latitude": location["latitude"],
                "longitude": location["longitude"],
                "updatedAt": location["updated_at"],
            }
            if location and status in ("accepted", "picked_up")
            else None
        )
    a = receipt.get("address")
    return {
        "id": receipt["id"],
        "orderNumber": receipt["order_number"],
        "merchantId": merchant["id"],
        "merchantName": merchant["name"],
        "mode": receipt["mode"],
        "status": status,
        "createdAt": receipt["created_at"],
        "totalCents": receipt["quote"]["totalCents"],
        "courierLocation": position,
        "dropoff": {"latitude": a["latitude"], "longitude": a["longitude"]}
        if a
        else None,
        "merchant": {
            "latitude": merchant["latitude"],
            "longitude": merchant["longitude"],
        },
        "reviewed": receipt.get("reviewed", False),
    }


@router.get("/orders")
async def my_orders(authorization: str | None = Header(default=None)):
    _, uid = await require_user(authorization)
    since = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    rows = await _get(
        "consumer_receipts",
        {
            "customer_id": f"eq.{uid}",
            "created_at": f"gte.{since}",
            "select": "*",
            "order": "created_at.desc",
            "limit": "30",
        },
        private=True,
    )
    if not rows:
        return {"orders": []}
    # Three bounded reads instead of three round trips per historical order.
    merchant_ids = ",".join(sorted({row["merchant_id"] for row in rows}))
    order_ids = ",".join(row["id"] for row in rows)
    stores, dispatch, locations = await asyncio.gather(
        _get(
            "consumer_merchants",
            {"id": f"in.({merchant_ids})", "select": "*", "limit": "30"},
            private=True,
        ),
        _get(
            "orders",
            {"id": f"in.({order_ids})", "select": "id,delivery_status", "limit": "30"},
            private=True,
        ),
        _get(
            "consumer_courier_locations",
            {
                "order_id": f"in.({order_ids})",
                "select": "order_id,latitude,longitude,updated_at",
                "limit": "30",
            },
            private=True,
        ),
    )
    cached = {
        "merchants": {row["id"]: row for row in stores},
        "dispatch": {row["id"]: row for row in dispatch},
        "locations": {row["order_id"]: row for row in locations},
    }
    return {"orders": [await public_order(row, cached) for row in rows]}


@router.get("/orders/{order_id}")
async def my_order(
    order_id: uuid.UUID, authorization: str | None = Header(default=None)
):
    _, uid = await require_user(authorization)
    return await public_order(await receipt_for(str(order_id), uid))


class LocationBody(Contract):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    accuracy: float = Field(ge=0, le=500, allow_inf_nan=False)
    recordedAt: datetime


@router.post("/orders/{order_id}/location")
async def share_location(
    order_id: uuid.UUID,
    body: LocationBody,
    authorization: str | None = Header(default=None),
):
    _, uid = await _require_driver(authorization)
    now = datetime.now(timezone.utc)
    if (
        body.recordedAt.tzinfo is None
        or not -15 <= (now - body.recordedAt).total_seconds() <= 120
    ):
        raise HTTPException(422, "The location timestamp is stale or invalid.")
    rows = await _get(
        "orders",
        {
            "id": f"eq.{order_id}",
            "accepted_by": f"eq.{uid}",
            "delivery_status": "in.(accepted,picked_up)",
            "select": "id",
            "limit": "1",
        },
        private=True,
    )
    if not rows:
        raise HTTPException(
            403, "Only the assigned courier may share an active delivery location."
        )
    res = await _post(
        f"{REST_URL}/rpc/consumer_share_location",
        headers=_service(),
        json={
            "p_order_id": str(order_id),
            "p_driver_id": uid,
            "p_latitude": body.latitude,
            "p_longitude": body.longitude,
            "p_recorded_at": body.recordedAt.isoformat(),
        },
    )
    if res.status_code != 200:
        raise HTTPException(503, "Location sharing is temporarily unavailable.")
    if res.json() is not True:
        raise HTTPException(409, "The delivery or location has changed.")
    return {"ok": True}


class PickupStatusBody(Contract):
    status: Literal["preparing", "ready", "completed"]


@router.post("/merchant/orders/{order_id}/status")
async def pickup_status(
    order_id: uuid.UUID,
    body: PickupStatusBody,
    authorization: str | None = Header(default=None),
):
    token, uid = await require_user(authorization)
    staff = await _get(
        "consumer_merchant_staff",
        {"user_id": f"eq.{uid}", "select": "merchant_id"},
        private=True,
    )
    if not staff:
        raise HTTPException(403, "Store staff access is required.")
    rows = await _get(
        "consumer_receipts",
        {"id": f"eq.{order_id}", "mode": "eq.pickup", "select": "*", "limit": "1"},
        private=True,
    )
    if not rows:
        raise HTTPException(404, "Pickup order not found.")
    row = rows[0]
    if row["merchant_id"] not in {s["merchant_id"] for s in staff}:
        raise HTTPException(403, "This order belongs to another store.")
    previous = {"preparing": "placed", "ready": "preparing", "completed": "ready"}[
        body.status
    ]
    if row["status"] == body.status:
        return {"ok": True}
    if row["status"] != previous:
        raise HTTPException(409, "Pickup stages must be completed in order.")
    res = await client.patch(
        f"{REST_URL}/consumer_receipts",
        headers={**_service(), "Prefer": "return=representation"},
        params={"id": f"eq.{order_id}", "status": f"eq.{previous}"},
        json={"status": body.status},
    )
    if res.status_code != 200 or not res.json():
        raise HTTPException(409, "Order changed. Refresh and try again.")
    return {"ok": True}


@router.get("/merchant/orders")
async def merchant_orders(authorization: str | None = Header(default=None)):
    _, uid = await require_user(authorization)
    staff = await _get(
        "consumer_merchant_staff",
        {"user_id": f"eq.{uid}", "select": "merchant_id"},
        private=True,
    )
    ids = [s["merchant_id"] for s in staff]
    if not ids:
        raise HTTPException(403, "Store staff access is required.")
    rows = await _get(
        "consumer_receipts",
        {
            "merchant_id": f"in.({','.join(ids)})",
            "mode": "eq.pickup",
            "status": "in.(placed,preparing,ready)",
            "select": "id,order_number,merchant_id,status,items,customer_name,created_at",
            "order": "created_at.asc",
            "limit": "100",
        },
        private=True,
    )
    return {"orders": rows}


class ReviewBody(Contract):
    rating: int = Field(ge=1, le=5, strict=True)


@router.post("/orders/{order_id}/review")
async def review(
    order_id: uuid.UUID,
    body: ReviewBody,
    authorization: str | None = Header(default=None),
):
    _, uid = await require_user(authorization)
    receipt = await receipt_for(str(order_id), uid)
    result = await public_order(receipt)
    if result["status"] not in ("delivered", "completed"):
        raise HTTPException(409, "You can review a store after your order is complete.")
    res = await _post(
        f"{REST_URL}/consumer_reviews",
        headers={**_service(), "Prefer": "return=minimal"},
        json={
            "order_id": str(order_id),
            "merchant_id": receipt["merchant_id"],
            "customer_id": uid,
            "rating": body.rating,
        },
    )
    if res.status_code == 409:
        raise HTTPException(409, "This order has already been reviewed.")
    if res.status_code not in (200, 201, 204):
        raise HTTPException(503, "Your review could not be saved.")
    return {"ok": True}


@router.get("/merchants/{merchant_id}/menu")
async def merchant_menu(merchant_id: str):
    await merchant_by_id(merchant_id)
    return {"items": [item for item in MENU if item["merchant_id"] == merchant_id]}
