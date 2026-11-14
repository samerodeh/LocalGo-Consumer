"""Push notification dispatcher — the FastAPI port of the old `notify-push`
Supabase edge function. Recipients are ALWAYS derived server-side from the
`orders` row (service-role key, bypasses RLS), never trusted from the client:
the caller only says WHAT happened (orderId + kind [+ senderId for messages]);
this endpoint decides WHO gets notified and fetches their device token(s)."""

from typing import Literal
from uuid import UUID

import httpx
from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .. import config
from ..auth import require_user
from ..postgrest import REST_URL, client, headers

router = APIRouter()

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

NotifyKind = Literal[
    "new_order",
    "order_accepted",
    "order_picked_up",
    "order_delivered",
    "new_message",
]


class NotifyBody(BaseModel):
    orderId: UUID
    kind: NotifyKind
    senderId: str | None = None
    preview: str | None = Field(default=None, max_length=120)


def _json(status: int, content: dict) -> JSONResponse:
    return JSONResponse(status_code=status, content=content)


async def send_notification(body: NotifyBody) -> JSONResponse:
    """Shared by the /notify route and the orders router (which fires
    new_order / order_accepted itself after a successful write)."""
    if not config.SUPABASE_SERVICE_ROLE_KEY:
        return _json(503, {"error": "Service role key not configured"})

    admin = headers(service=True)

    order_res = await client.get(
        f"{REST_URL}/orders",
        headers=admin,
        params={
            "id": f"eq.{body.orderId}",
            "select": "id,order_number,order_total,item_count,customer_id,accepted_by,eta_minutes",
            "limit": "1",
        },
    )
    rows = order_res.json() if order_res.status_code == 200 else []
    if not rows:
        return _json(404, {"error": "Order not found"})
    order = rows[0]

    recipient_ids: list[str] = []
    title = ""
    message_body = ""

    if body.kind == "new_order":
        # Only the approved, online driver with no active delivery receives offers.
        drivers_res = await client.get(
            f"{REST_URL}/driver_dispatch", headers=admin, params={"select": "driver_id", "is_online": "eq.true"}
        )
        drivers = drivers_res.json() if drivers_res.status_code == 200 else []
        recipient_ids = [d["driver_id"] for d in drivers]
        if recipient_ids:
            active_res = await client.get(
                f"{REST_URL}/orders", headers=admin,
                params={"select": "accepted_by", "accepted_by": f"in.({','.join(recipient_ids)})", "delivery_status": "in.(accepted,picked_up)"},
            )
            if active_res.status_code != 200:
                return _json(503, {"error": "Could not verify driver availability"})
            busy_ids = {row["accepted_by"] for row in active_res.json()}
            recipient_ids = [uid for uid in recipient_ids if uid not in busy_ids]

        count = order["item_count"]
        title = "New order available"
        message_body = (
            f"{order['order_number']} · {count} item{'' if count == 1 else 's'}"
            f" · ${float(order['order_total']):.2f}"
        )
    elif body.kind == "order_accepted":
        if not order.get("customer_id"):
            return _json(200, {"sent": 0, "reason": "order has no customer_id"})
        recipient_ids = [order["customer_id"]]
        title = "Driver on the way to pick up your order"
        eta = order.get("eta_minutes")
        message_body = (
            f"A driver accepted {order['order_number']} and is heading to the restaurant"
            f" — arriving in about {eta} min."
            if eta
            else f"A driver accepted {order['order_number']} and is heading to the restaurant."
        )
    elif body.kind == "order_picked_up":
        if not order.get("customer_id"):
            return _json(200, {"sent": 0, "reason": "order has no customer_id"})
        recipient_ids = [order["customer_id"]]
        title = "Your order is on the way!"
        message_body = (
            f"{order['order_number']} has been picked up and is on its way to you."
        )
    elif body.kind == "order_delivered":
        if not order.get("customer_id"):
            return _json(200, {"sent": 0, "reason": "order has no customer_id"})
        recipient_ids = [order["customer_id"]]
        title = "Your order has arrived!"
        message_body = (
            f"{order['order_number']} has been delivered to your drop-off spot. Enjoy!"
        )
    else:  # new_message: notify whichever participant did NOT send it.
        if not body.senderId:
            return _json(400, {"error": "senderId required for new_message"})
        if body.senderId == order.get("customer_id"):
            other = order.get("accepted_by")
        elif body.senderId == order.get("accepted_by"):
            other = order.get("customer_id")
        else:
            other = None
        if not other:
            return _json(200, {"sent": 0, "reason": "sender is not a participant"})
        recipient_ids = [other]
        title = "New message"
        message_body = (body.preview or "You have a new message.")[:120]

    if not recipient_ids:
        return _json(200, {"sent": 0})

    tokens_res = await client.get(
        f"{REST_URL}/push_tokens",
        headers=admin,
        params={
            "select": "user_id,token",
            "user_id": f"in.({','.join(recipient_ids)})",
        },
    )
    token_rows = tokens_res.json() if tokens_res.status_code == 200 else []
    tokens = [t["token"] for t in token_rows]
    if not tokens:
        return _json(200, {"sent": 0, "reason": "no registered devices"})

    messages = [
        {
            "to": to,
            "title": title,
            "body": message_body,
            "sound": "default",
            "data": {"orderId": str(body.orderId), "kind": body.kind},
        }
        for to in tokens
    ]

    try:
        expo_res = await client.post(
            EXPO_PUSH_URL,
            headers={"content-type": "application/json", "accept": "application/json"},
            json=messages,
        )
    except httpx.HTTPError as exc:
        return _json(502, {"error": f"Expo push API unreachable: {exc}"})
    if expo_res.status_code != 200:
        print(f"[notify] Expo push API error {expo_res.status_code} {expo_res.text[:500]}")
        return _json(502, {"error": f"Expo push API error ({expo_res.status_code})"})

    return _json(200, {"sent": len(tokens)})


@router.post("/notify")
async def notify(body: NotifyBody, authorization: str | None = Header(default=None)):
    bearer, uid = await require_user(authorization)
    # Order lifecycle alerts are emitted only by the backend after a write.
    if body.kind != "new_message":
        raise HTTPException(403, "Order notifications are managed by the server")
    response = await client.get(
        f"{REST_URL}/orders", headers=headers(bearer),
        params={"id": f"eq.{body.orderId}", "select": "customer_id,accepted_by", "limit": "1"},
    )
    if response.status_code != 200:
        raise HTTPException(502, "Could not verify notification access")
    rows = response.json()
    if not rows or not rows[0].get("accepted_by") or uid not in (rows[0].get("customer_id"), rows[0].get("accepted_by")):
        raise HTTPException(403, "Only order participants can send notifications")
    # Never trust a client-supplied sender or expose chat contents on lock screens.
    return await send_notification(body.model_copy(update={"senderId": uid, "preview": "You have a new message."}))

