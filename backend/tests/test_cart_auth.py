import asyncio
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from app import auth, config


def test_session_uses_verified_auth_user_and_forwards_token(supabase_on, monkeypatch):
    verified = uuid4()
    calls = []

    class Client:
        async def get(self, url, **kwargs):
            calls.append((url, kwargs))
            return httpx.Response(200, json={"id": str(verified)})

    monkeypatch.setattr(auth, "client", Client())
    session = asyncio.run(auth.require_customer("Bearer not-decoded-locally"))
    assert session.user_id == verified
    assert calls[0][1]["headers"]["Authorization"] == "Bearer not-decoded-locally"
    assert "not-decoded-locally" not in repr(session)


@pytest.mark.parametrize("status,payload,expected", [
    (401, {}, 401), (403, {}, 401), (500, {}, 503),
    (200, {}, 503), (200, {"id": "not-a-uuid"}, 503),
])
def test_invalid_sessions_fail_closed(supabase_on, monkeypatch, status, payload, expected):
    class Client:
        async def get(self, *args, **kwargs):
            return httpx.Response(status, json=payload)

    monkeypatch.setattr(auth, "client", Client())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_customer("Bearer forged"))
    assert exc.value.status_code == expected


def test_missing_or_unconfigured_auth_fails(supabase_on, monkeypatch):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_customer(None))
    assert exc.value.status_code == 401
    monkeypatch.setattr(config, "SUPABASE_CONFIGURED", False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_customer("Bearer anything"))
    assert exc.value.status_code == 503


def test_session_route_returns_only_verified_identity(client, supabase_on, monkeypatch):
    owner = uuid4()

    class Client:
        async def get(self, *args, **kwargs):
            return httpx.Response(200, json={'id': str(owner), 'email': 'not-exposed@example.com'})

    monkeypatch.setattr(auth, 'client', Client())
    assert client.get('/v1/session').status_code == 401
    response = client.get('/v1/session', headers={'Authorization': 'Bearer private-token'})
    assert response.json() == {'user_id': str(owner)}
    assert 'private-token' not in response.text


def test_auth_network_failure_is_unavailable(supabase_on, monkeypatch):
    class Client:
        async def get(self, *args, **kwargs):
            raise httpx.ConnectError("unreachable")

    monkeypatch.setattr(auth, "client", Client())
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.require_customer("Bearer token"))
    assert exc.value.status_code == 503
