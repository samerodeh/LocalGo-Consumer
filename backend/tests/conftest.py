"""Shared fixtures.

Nothing here touches the network. Stripe and PostgREST are stubbed, so the
suite runs offline, costs nothing, and can't be broken by a slow Render
instance or an expired key.

`config` values are module-level globals read at call time, so tests set them
through monkeypatch and pytest restores them afterwards — otherwise one test
leaving STRIPE_CONFIGURED=True would silently change the meaning of the next.
"""

import sys
from pathlib import Path

import pytest
import stripe

# The app is imported as `app.*`, so the backend dir has to be importable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app import config  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def hermetic(monkeypatch):
    """Force every test to start from "nothing configured".

    Without this the suite reads whatever is in backend/.env, so on a developer
    machine with real keys a test meant to exercise the unconfigured path
    instead reached the live Stripe API and created a real PaymentIntent. Tests
    must never depend on ambient config or touch the network.

    Tests that need a configured service opt in via the `stripe_on` /
    `supabase_on` fixtures, which run after this one.
    """
    monkeypatch.setattr(config, "SERVER_CART_ENABLED", False)
    monkeypatch.setattr(config, "STRIPE_CONFIGURED", False)
    monkeypatch.setattr(config, "STRIPE_SECRET_KEY", "")
    monkeypatch.setattr(config, "STRIPE_PUBLISHABLE_KEY", "")
    monkeypatch.setattr(config, "STRIPE_WEBHOOK_SECRET", "")
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", False)
    monkeypatch.setattr(config, "SUPABASE_ANON_KEY", "")
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "")
    # Same reasoning as the Stripe keys above, one failure mode worse: a real
    # SMTP_* in backend/.env would let a test actually send mail to whatever
    # address the stubbed order row happened to carry.
    monkeypatch.setattr(config, "EMAIL_CONFIGURED", False)
    monkeypatch.setattr(config, "SMTP_HOST", "")
    monkeypatch.setattr(config, "SMTP_USER", "")
    monkeypatch.setattr(config, "SMTP_PASSWORD", "")
    # Belt and braces: even if a stub is forgotten, the key can't authenticate.
    monkeypatch.setattr(stripe, "api_key", "sk_test_never_valid")


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def stripe_on(monkeypatch):
    """Payments configured, with fake keys. No real Stripe call is ever made."""
    monkeypatch.setattr(config, "STRIPE_CONFIGURED", True)
    monkeypatch.setattr(config, "STRIPE_SECRET_KEY", "sk_test_stub")
    monkeypatch.setattr(config, "STRIPE_PUBLISHABLE_KEY", "pk_test_stub")


@pytest.fixture
def supabase_on(monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(config, "SUPABASE_ANON_KEY", "anon_stub")
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "service_stub")


class FakeIntent:
    """Stand-in for stripe.PaymentIntent.

    `metadata` is deliberately a plain dict here, but the production code must
    not assume that — the real StripeObject has no .get(), which is exactly the
    bug that shipped past a dict-based stub once already. test_orders_gate has a
    dedicated case for the StripeObject shape.
    """

    def __init__(self, *, id="pi_stub", amount=0, status="succeeded", order_id=None,
                 client_secret="pi_stub_secret"):
        self.id = id
        self.amount = amount
        self.status = status
        self.client_secret = client_secret
        self.metadata = {"order_id": order_id} if order_id else {}
        self.currency = "cad"


@pytest.fixture
def order_id():
    return "e0e1c0de-0000-4000-8000-000000000001"
