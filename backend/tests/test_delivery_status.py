"""POST /orders/{id}/status — the customer-facing delivery milestones.

The properties that matter here:

  * Every milestone the customer is promised a notification for actually
    mirrors onto the shared orders row AND fires a push. A status that updates
    the driver's private overlay but never reaches the customer is invisible
    and would look identical to a working one in manual testing.
  * 'declined' stays private to the driver — it is not a delivery milestone.
  * The pickup photo lands in `pickup_photo_url` and nowhere else, since that
    column is what the emailed receipt reads.
"""

import asyncio

from app import config
from app.routers import orders as orders_router
from app.routers.orders import StatusBody, update_status


class Res:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class FakeClient:
    """Records every PostgREST call so tests can assert what was written."""

    def __init__(self):
        self.calls = []

    async def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        return Res(200, [])

    async def post(self, url, **kw):
        self.calls.append(("POST", url, kw))
        return Res(201)

    async def patch(self, url, **kw):
        self.calls.append(("PATCH", url, kw))
        return Res(204)

    def patches_to(self, table):
        return [c for c in self.calls if c[0] == "PATCH" and c[1].endswith(table)]

    def posts_to(self, table):
        return [c for c in self.calls if c[0] == "POST" and c[1].endswith(table)]


def token_for(sub):
    """A JWT-shaped string jwt_sub can pull `sub` out of. Signature is garbage —
    the endpoint only uses `sub` as a query filter (RLS is the real gate)."""
    import base64
    import json

    payload = base64.urlsafe_b64encode(json.dumps({"sub": sub}).encode()).rstrip(b"=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload.decode()}.sig"


DRIVER = "d0000000-0000-4000-8000-000000000001"


def run_status(monkeypatch, status, photo_url=None):
    """Drive the endpoint with everything stubbed, returning (fake, notified)."""
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "service_stub")

    fake = FakeClient()
    monkeypatch.setattr(orders_router, "client", fake)

    notified = []

    async def fake_notify(body):
        notified.append(body.kind)

    monkeypatch.setattr(orders_router, "send_notification", fake_notify)

    asyncio.run(
        update_status(
            "e0e1c0de-0000-4000-8000-000000000001",
            StatusBody(status=status, photo_url=photo_url),
            authorization=f"Bearer {token_for(DRIVER)}",
        )
    )
    return fake, notified


def test_every_milestone_notifies_the_customer(monkeypatch):
    """The four beats the customer is promised: picked up, nearby, here, done."""
    expected = {
        "picked_up": "order_picked_up",
        "nearby": "order_nearby",
        "arrived": "order_arrived",
        "delivered": "order_delivered",
    }
    for status, kind in expected.items():
        _, notified = run_status(monkeypatch, status)
        assert notified == [kind], f"{status} should push {kind}, got {notified}"


def test_every_milestone_mirrors_onto_the_shared_order_row(monkeypatch):
    """The customer can't read driver_orders — the mirror is the only way
    progress reaches their tracking screen and order history."""
    for status in ("picked_up", "nearby", "arrived", "delivered"):
        fake, _ = run_status(monkeypatch, status)
        mirrors = fake.patches_to("/orders")
        assert len(mirrors) == 1, f"{status} should mirror exactly once"
        assert mirrors[0][2]["json"]["delivery_status"] == status


def test_each_milestone_stamps_its_own_timestamp(monkeypatch):
    for status, column in (
        ("picked_up", "picked_up_at"),
        ("nearby", "nearby_at"),
        ("arrived", "arrived_at"),
        ("delivered", "delivered_at"),
    ):
        fake, _ = run_status(monkeypatch, status)
        patch = fake.patches_to("/orders")[0][2]["json"]
        assert column in patch, f"{status} should stamp {column}"


def test_declining_stays_private_to_the_driver(monkeypatch):
    """A driver passing on an order is not a delivery milestone: it must not
    touch the shared row (the order stays available to everyone else) and must
    not notify the customer, who would otherwise get an alarming push."""
    fake, notified = run_status(monkeypatch, "declined")
    assert notified == []
    assert fake.patches_to("/orders") == []
    # It still records the driver's own overlay row, which is what hides the
    # order from this driver's feed.
    assert len(fake.posts_to("/driver_orders")) == 1


def test_pickup_photo_lands_in_the_pickup_column(monkeypatch):
    fake, _ = run_status(monkeypatch, "picked_up", photo_url="https://cdn/x/pickup.jpg")
    patch = fake.patches_to("/orders")[0][2]["json"]
    assert patch["pickup_photo_url"] == "https://cdn/x/pickup.jpg"
    assert "dropoff_photo_url" not in patch


def test_dropoff_photo_lands_in_the_dropoff_column(monkeypatch):
    fake, _ = run_status(monkeypatch, "delivered", photo_url="https://cdn/x/drop.jpg")
    patch = fake.patches_to("/orders")[0][2]["json"]
    assert patch["dropoff_photo_url"] == "https://cdn/x/drop.jpg"
    assert "pickup_photo_url" not in patch


def test_approach_milestones_carry_no_photo(monkeypatch):
    """'nearby'/'arrived' are one-tap by design — a driver walking up to a door
    shouldn't have to stop and use the camera. Even if a client sent a url,
    there is no column for it."""
    for status in ("nearby", "arrived"):
        fake, _ = run_status(monkeypatch, status, photo_url="https://cdn/x/stray.jpg")
        patch = fake.patches_to("/orders")[0][2]["json"]
        assert "pickup_photo_url" not in patch
        assert "dropoff_photo_url" not in patch


def test_status_requires_a_driver_token(monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    fake = FakeClient()
    monkeypatch.setattr(orders_router, "client", fake)

    try:
        asyncio.run(
            update_status(
                "e0e1c0de-0000-4000-8000-000000000001",
                StatusBody(status="picked_up"),
                authorization=None,
            )
        )
    except Exception as exc:  # HTTPException
        assert getattr(exc, "status_code", None) == 401
    else:  # pragma: no cover - the assertion below is the real failure message
        raise AssertionError("an unauthenticated status write must be rejected")
    assert fake.calls == []
