"""DELETE /account — the most destructive endpoint in the service.

The property that matters most: deletion targets the uid Supabase Auth
resolves the token to, never the uid the token claims. postgrest.jwt_sub
decodes without verifying a signature, so trusting it here would let a forged
token delete anyone's account.
"""

import asyncio
import base64
import json
import uuid

from app import config
from app.postgrest import jwt_sub
from app.routers import account


class Res:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


class FakeClient:
    """Records every call so tests can assert what deletion actually touched."""

    def __init__(self, auth_response):
        self.auth_response = auth_response
        self.calls = []

    async def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        return self.auth_response

    async def patch(self, url, **kw):
        self.calls.append(("PATCH", url, kw))
        return Res(204)

    async def delete(self, url, **kw):
        self.calls.append(("DELETE", url, kw))
        return Res(204)

    def writes(self):
        return [c for c in self.calls if c[0] in ("PATCH", "DELETE")]


def forged_token(claimed_sub):
    """A syntactically valid JWT with a garbage signature."""
    payload = base64.urlsafe_b64encode(json.dumps({"sub": claimed_sub}).encode()).rstrip(b"=")
    return f"eyJhbGciOiJIUzI1NiJ9.{payload.decode()}.not_a_real_signature"


def test_jwt_sub_is_fooled_by_a_forged_token():
    """Documents WHY _verify_caller exists. If this ever starts failing,
    jwt_sub gained verification and this file's premise should be revisited."""
    assert jwt_sub(forged_token("victim-uid")) == "victim-uid"


def test_refuses_without_service_role_key(client, monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "")
    # Can't bypass RLS to scrub rows, so refuse rather than half-delete.
    assert client.delete("/account").status_code == 503


def test_refuses_without_supabase(client, monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", False)
    assert client.delete("/account").status_code == 503


def test_requires_a_token(client, supabase_on):
    assert client.delete("/account").status_code == 401


def test_forged_token_deletes_nothing(client, supabase_on, monkeypatch):
    """Supabase says the token is invalid -> 401, and NOTHING is written."""
    fake = FakeClient(Res(401, {"msg": "invalid"}))
    monkeypatch.setattr(account, "client", fake)

    r = client.delete("/account", headers={"Authorization": f"Bearer {forged_token('victim-uid')}"})
    assert r.status_code == 401
    assert fake.writes() == [], "a rejected token still triggered writes"


def test_deletion_targets_the_verified_uid_not_the_claimed_one(client, supabase_on, monkeypatch):
    """The whole point: token claims 'victim', Supabase resolves 'attacker'.
    Every write must target attacker."""
    fake = FakeClient(Res(200, {"id": "attacker-uid"}))
    monkeypatch.setattr(account, "client", fake)

    r = client.delete("/account", headers={"Authorization": f"Bearer {forged_token('victim-uid')}"})
    assert r.status_code == 200
    assert r.json() == {"deleted": True}

    blob = json.dumps(fake.writes(), default=str)
    assert "attacker-uid" in blob
    assert "victim-uid" not in blob, "a write targeted the uid the token merely claimed"


def test_scrub_keeps_the_order_but_removes_the_person(client, supabase_on, monkeypatch):
    fake = FakeClient(Res(200, {"id": "u1"}))
    monkeypatch.setattr(account, "client", fake)
    client.delete("/account", headers={"Authorization": "Bearer tok"})

    patches = [c for c in fake.calls if c[0] == "PATCH"]
    assert len(patches) == 1, "orders must be scrubbed exactly once"
    payload = patches[0][2]["json"]
    assert payload["customer_id"] is None
    assert payload["customer_name"] == account.REDACTED_NAME
    assert payload["dropoff_address"] == account.REDACTED_ADDRESS
    # The money and the row itself survive — these are business records.
    assert "order_total" not in payload
    assert "id" not in payload


def test_order_scrub_runs_before_the_account_is_deleted(client, supabase_on, monkeypatch):
    """orders.customer_id has no FK, so deleting the user first would strand
    identifiable rows this endpoint could no longer find."""
    fake = FakeClient(Res(200, {"id": "u1"}))
    monkeypatch.setattr(account, "client", fake)
    client.delete("/account", headers={"Authorization": "Bearer tok"})

    kinds = [(c[0], c[1]) for c in fake.calls]
    scrub = next(i for i, (m, u) in enumerate(kinds) if m == "PATCH" and "orders" in u)
    user_delete = next(i for i, (m, u) in enumerate(kinds) if m == "DELETE" and "admin/users" in u)
    assert scrub < user_delete


def test_failed_scrub_aborts_before_deleting_the_account(client, supabase_on, monkeypatch):
    """Better to leave the account alive than to delete it and orphan rows
    still carrying the customer's name and address."""

    class FailingScrub(FakeClient):
        async def patch(self, url, **kw):
            self.calls.append(("PATCH", url, kw))
            return Res(500, text="boom")

    fake = FailingScrub(Res(200, {"id": "u1"}))
    monkeypatch.setattr(account, "client", fake)

    r = client.delete("/account", headers={"Authorization": "Bearer tok"})
    assert r.status_code == 502
    assert not any(m == "DELETE" and "admin/users" in u for m, u, _ in fake.calls), (
        "account was deleted even though the scrub failed"
    )


def test_order_lookup_never_false_alarms(monkeypatch):
    """Webhook orphan detection: an unknown answer must be None, never False —
    False would report every charge as an orphaned payment."""
    from app.routers import payments

    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", False)
    assert asyncio.run(payments._order_exists(str(uuid.uuid4()))) is None

    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", True)
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "")
    assert asyncio.run(payments._order_exists(str(uuid.uuid4()))) is None
