import asyncio
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from app import config
from app.cart import repository
from app.cart.models import Cart, CartError


def test_adapter_reads_under_rls_and_commits_with_server_identity(supabase_on, monkeypatch):
    calls = []
    owner = uuid4()
    cart = Cart(revision=1)

    class Client:
        async def request(self, method, url, **kwargs):
            calls.append((method, url, kwargs))
            payload = {"status": "ok", "cart": cart.model_dump()} if method == "POST" else []
            return httpx.Response(200, json=payload)

    monkeypatch.setattr(repository, "client", Client())
    repo = repository.SupabaseCartRepository()
    assert asyncio.run(repo.load(owner, "user-token")) == Cart()
    assert asyncio.run(repo.receipt(owner, "key")) is None
    assert asyncio.run(repo.commit(owner, 0, "key", "a" * 64, cart)) == cart
    assert calls[0][2]["headers"]["Authorization"] == "Bearer user-token"
    assert calls[0][2]["params"]["user_id"] == f"eq.{owner}"
    assert calls[1][2]["headers"]["Authorization"] == "Bearer service_stub"
    assert calls[2][2]["json"]["p_user_id"] == str(owner)
    assert calls[2][2]["json"]["p_expected_revision"] == 0


@pytest.mark.parametrize("status", ["CART_REVISION_CONFLICT", "IDEMPOTENCY_CONFLICT"])
def test_adapter_maps_atomic_rpc_conflicts(supabase_on, monkeypatch, status):
    class Client:
        async def request(self, *args, **kwargs):
            return httpx.Response(200, json={"status": status})

    monkeypatch.setattr(repository, "client", Client())
    with pytest.raises(CartError) as exc:
        asyncio.run(repository.SupabaseCartRepository().commit(uuid4(), 0, "key", "a" * 64, Cart(revision=1)))
    assert exc.value.code == status


def test_storage_must_be_configured_and_valid(supabase_on, monkeypatch):
    monkeypatch.setattr(config, "SUPABASE_SERVICE_ROLE_KEY", "")
    with pytest.raises(CartError) as exc:
        asyncio.run(repository.SupabaseCartRepository().load(uuid4(), "token"))
    assert exc.value.status == 503


def test_sql_migration_restricts_writes_and_records_receipts_atomically():
    sql = (Path(__file__).resolve().parents[2] / "supabase/migrations/202611040001_customer_carts.sql").read_text()
    assert "for select to authenticated using (user_id = (select auth.uid()))" in sql
    assert "from public, anon, authenticated" in sql
    assert "to service_role" in sql
    assert "pg_advisory_xact_lock" in sql
    assert "primary key (user_id, request_key)" in sql
    assert "on delete cascade" in sql
