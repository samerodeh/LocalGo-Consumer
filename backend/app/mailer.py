"""Outbound email — the delivery receipt that carries the driver's pickup photo.

Deliberately stdlib `smtplib` + `email.message` rather than a provider SDK: it
adds no dependency, and every provider worth using (SES, Resend, Postmark,
Mailgun, or a Gmail app password) speaks plain SMTP. Same degradation contract
as every other service here — with no SMTP_* env vars this module is a no-op
that returns False, so a backend without mail configured still completes every
pickup normally.

`smtplib` is blocking, so the send runs on a worker thread; callers await it
without stalling the event loop.
"""

import asyncio
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from typing import Any

import httpx

from . import config
from .postgrest import client, headers

# A pickup photo is a phone snapshot of a bag on a counter. Anything larger than
# this is not a photo we want to push through an SMTP relay (many cap the whole
# message near 10-25 MB, and base64 inflates by ~33%), so it degrades to a link.
MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024


async def customer_email(customer_id: str) -> str | None:
    """The signed-up email for a customer uid, via Supabase Auth's admin API.

    Deliberately not stored on the orders row: Auth already owns the address,
    and copying it at checkout would leave stale copies behind whenever someone
    changes their email. Requires the service-role key (admin endpoint).
    """
    if not config.SUPABASE_SERVICE_ROLE_KEY:
        return None
    try:
        res = await client.get(
            f"{config.SUPABASE_URL}/auth/v1/admin/users/{customer_id}",
            headers=headers(service=True),
        )
    except httpx.HTTPError as exc:
        print(f"[mailer] auth lookup failed: {exc}")
        return None
    if res.status_code != 200:
        print(f"[mailer] auth lookup returned {res.status_code}")
        return None
    email = res.json().get("email")
    return email if isinstance(email, str) and "@" in email else None


async def _fetch_photo(url: str) -> tuple[bytes, str] | None:
    """Download the proof photo so it can ride along as a real attachment.

    The `order-photos` bucket is public, so no auth is needed. Returns None on
    any failure — the email still goes out, just with a link instead.
    """
    try:
        res = await client.get(url, timeout=20.0)
    except httpx.HTTPError as exc:
        print(f"[mailer] photo fetch failed: {exc}")
        return None
    if res.status_code != 200:
        print(f"[mailer] photo fetch returned {res.status_code}")
        return None
    if len(res.content) > MAX_ATTACHMENT_BYTES:
        print(f"[mailer] photo too large to attach ({len(res.content)} bytes)")
        return None
    subtype = (res.headers.get("content-type") or "image/jpeg").split("/")[-1].split(";")[0]
    return res.content, (subtype or "jpeg")


def _send(message: EmailMessage) -> None:
    """Blocking SMTP send. Runs on a worker thread via asyncio.to_thread."""
    if config.SMTP_USE_SSL:
        with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as smtp:
            smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
            smtp.send_message(message)
        return
    with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=20) as smtp:
        smtp.starttls()
        smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
        smtp.send_message(message)


def _body_html(order: dict[str, Any], photo_url: str | None, attached: bool) -> str:
    number = order.get("order_number") or "your order"
    restaurant = order.get("restaurant_name") or "the restaurant"
    eta = order.get("eta_minutes")
    eta_line = (
        f"<p style='margin:0 0 18px;color:#64748B;font-size:15px'>"
        f"Estimated arrival: about {eta} minutes.</p>"
        if eta
        else ""
    )
    # cid: only resolves when the bytes actually rode along; otherwise point the
    # <img> straight at the public bucket URL so the mail still shows a photo.
    img_src = "cid:pickupphoto" if attached else (photo_url or "")
    photo_block = (
        f"<img src='{img_src}' alt='Your order at pickup' "
        f"style='width:100%;max-width:520px;border-radius:12px;display:block' />"
        if img_src
        else ""
    )
    return f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
            max-width:560px;margin:0 auto;padding:24px">
  <p style="margin:0 0 4px;color:#F97316;font-size:13px;font-weight:700;
            letter-spacing:.08em;text-transform:uppercase">LocalGO</p>
  <h1 style="margin:0 0 12px;color:#0F172A;font-size:26px">Your order is on the way</h1>
  <p style="margin:0 0 6px;color:#0F172A;font-size:15px">
    Your driver just picked up <strong>{number}</strong> from {restaurant}
    and is heading to you now.
  </p>
  {eta_line}
  <p style="margin:0 0 10px;color:#0F172A;font-size:15px;font-weight:600">
    Here's your order at pickup:
  </p>
  {photo_block}
  <p style="margin:22px 0 0;color:#94A3B8;font-size:12px">
    You're getting this because you placed an order with LocalGO.
    Track it live in the app.
  </p>
</div>"""


async def send_pickup_photo_email(
    to_email: str, order: dict[str, Any], photo_url: str | None
) -> bool:
    """Mail the customer the photo their driver took of the order at pickup.

    Best-effort by contract: returns False (never raises) when mail isn't
    configured or the send fails, so a pickup is never blocked by the mailer.
    """
    if not config.EMAIL_CONFIGURED:
        return False

    photo = await _fetch_photo(photo_url) if photo_url else None

    message = EmailMessage()
    message["Subject"] = (
        f"Your LocalGO order {order.get('order_number', '')} has been picked up".strip()
    )
    message["From"] = formataddr((config.SMTP_FROM_NAME, config.SMTP_FROM))
    message["To"] = to_email
    message.set_content(
        f"Your driver picked up {order.get('order_number', 'your order')} from "
        f"{order.get('restaurant_name', 'the restaurant')} and is on the way. "
        "The photo of your order is attached."
    )
    message.add_alternative(_body_html(order, photo_url, attached=photo is not None), subtype="html")

    if photo:
        data, subtype = photo
        # Attach onto the HTML alternative so `cid:pickupphoto` resolves inline
        # (a top-level attachment would show as a separate file in most clients).
        message.get_payload()[-1].add_related(
            data, maintype="image", subtype=subtype, cid="<pickupphoto>",
            filename="order-pickup.jpg",
        )

    try:
        await asyncio.to_thread(_send, message)
    except Exception as exc:  # noqa: BLE001 — never let mail break a delivery
        print(f"[mailer] send failed: {type(exc).__name__}: {exc}")
        return False
    return True
