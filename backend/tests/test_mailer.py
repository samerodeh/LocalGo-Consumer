"""The pickup-photo receipt.

Two failure modes this guards against, both of which look like success from
the outside:

  * Mailing when nothing is configured — a half-set SMTP_* would raise inside
    the status endpoint and block a driver from advancing a delivery they have
    already made.
  * Mailing without the photo. The whole message exists to carry that image, so
    a send that quietly dropped it would still "work" and still be useless.
"""

import asyncio

import pytest

from app import config, mailer
from app.mailer import send_pickup_photo_email

ORDER = {
    "id": "e0e1c0de-0000-4000-8000-000000000001",
    "order_number": "#LG-4821",
    "restaurant_name": "Al Taib",
    "eta_minutes": 45,
}
PHOTO_URL = "https://cdn.example/order-photos/x/pickup-1.jpg"


class Res:
    def __init__(self, status_code, content=b"", headers=None):
        self.status_code = status_code
        self.content = content
        self.headers = headers or {}

    def json(self):
        return {}


@pytest.fixture
def email_on(monkeypatch):
    monkeypatch.setattr(config, "EMAIL_CONFIGURED", True)
    monkeypatch.setattr(config, "SMTP_HOST", "smtp.example")
    monkeypatch.setattr(config, "SMTP_PORT", 587)
    monkeypatch.setattr(config, "SMTP_USER", "bot@localgo.example")
    monkeypatch.setattr(config, "SMTP_PASSWORD", "stub")
    monkeypatch.setattr(config, "SMTP_FROM", "bot@localgo.example")
    monkeypatch.setattr(config, "SMTP_FROM_NAME", "LocalGO")
    monkeypatch.setattr(config, "SMTP_USE_SSL", False)


@pytest.fixture
def sent(monkeypatch):
    """Captures the EmailMessage instead of opening an SMTP connection."""
    box = []
    monkeypatch.setattr(mailer, "_send", lambda message: box.append(message))
    return box


@pytest.fixture
def photo_ok(monkeypatch):
    class FakeClient:
        async def get(self, url, **kw):
            return Res(200, b"\xff\xd8\xff-jpeg-bytes", {"content-type": "image/jpeg"})

    monkeypatch.setattr(mailer, "client", FakeClient())


def test_unconfigured_email_sends_nothing(sent, photo_ok):
    """The hermetic fixture leaves EMAIL_CONFIGURED false — the default state
    for demo mode and for CI."""
    ok = asyncio.run(send_pickup_photo_email("a@b.com", ORDER, PHOTO_URL))
    assert ok is False
    assert sent == []


def test_configured_email_is_addressed_and_titled(email_on, sent, photo_ok):
    ok = asyncio.run(send_pickup_photo_email("customer@example.com", ORDER, PHOTO_URL))
    assert ok is True
    message = sent[0]
    assert message["To"] == "customer@example.com"
    assert "#LG-4821" in message["Subject"]
    assert "bot@localgo.example" in message["From"]


def test_the_photo_actually_rides_along(email_on, sent, photo_ok):
    """The point of the whole message."""
    message = None
    asyncio.run(send_pickup_photo_email("customer@example.com", ORDER, PHOTO_URL))
    message = sent[0]
    images = [
        part for part in message.walk() if part.get_content_maintype() == "image"
    ]
    assert len(images) == 1
    assert images[0].get_payload(decode=True) == b"\xff\xd8\xff-jpeg-bytes"


def test_an_unreachable_photo_still_sends_the_email(email_on, sent, monkeypatch):
    """A dead CDN shouldn't cost the customer the 'your order is on the way'
    message; the HTML falls back to linking the public bucket URL."""

    class Failing:
        async def get(self, url, **kw):
            return Res(404)

    monkeypatch.setattr(mailer, "client", Failing())
    ok = asyncio.run(send_pickup_photo_email("customer@example.com", ORDER, PHOTO_URL))
    assert ok is True
    body = sent[0].get_body(preferencelist=("html")).get_content()
    assert PHOTO_URL in body


def test_an_oversized_photo_is_not_attached(email_on, sent, monkeypatch):
    """Base64 inflates by a third and relays cap message size; a huge photo
    would bounce the whole email rather than arrive without an image."""

    class Huge:
        async def get(self, url, **kw):
            return Res(200, b"x" * (mailer.MAX_ATTACHMENT_BYTES + 1),
                       {"content-type": "image/jpeg"})

    monkeypatch.setattr(mailer, "client", Huge())
    ok = asyncio.run(send_pickup_photo_email("customer@example.com", ORDER, PHOTO_URL))
    assert ok is True
    assert [p for p in sent[0].walk() if p.get_content_maintype() == "image"] == []


def test_a_broken_relay_never_raises(email_on, photo_ok, monkeypatch):
    """The caller advances a delivery on the strength of this returning; it must
    report failure, not throw it into the status endpoint."""

    def boom(message):
        raise OSError("connection refused")

    monkeypatch.setattr(mailer, "_send", boom)
    assert asyncio.run(send_pickup_photo_email("c@example.com", ORDER, PHOTO_URL)) is False


def test_customer_email_needs_the_service_role_key(monkeypatch):
    """The Auth admin API is the only place a customer's address lives, and it
    is service-role only. Without the key this must resolve to None rather than
    issue an unauthorized request."""
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "")

    class Exploding:
        async def get(self, url, **kw):  # pragma: no cover - must not run
            raise AssertionError("no request should be made without the key")

    monkeypatch.setattr(mailer, "client", Exploding())
    assert asyncio.run(mailer.customer_email("c0000000-0000-4000-8000-000000000009")) is None
