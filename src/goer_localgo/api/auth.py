"""Request-scoped identity. Never persist a token or pass it to a model."""
import os
from dataclasses import dataclass, field
from uuid import UUID
from urllib.parse import urlsplit

import httpx
from fastapi import Header, HTTPException


@dataclass(frozen=True)
class Session:
    user_id: str
    access_token: str = field(repr=False)
    base_url: str


def backend_url() -> str:
    value = os.environ.get("LOCALGO_API_URL", "").rstrip("/")
    parsed = urlsplit(value)
    if (not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment
            or parsed.scheme not in ("https", "http")
            or (parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"))):
        raise HTTPException(503, "A trusted LOCALGO_API_URL is required.")
    return value


def carts_enabled() -> bool:
    return os.environ.get("GOER_CART_ENABLED", "false").lower() == "true"


async def optional_session(authorization: str | None = Header(default=None)) -> Session | None:
    if authorization is None:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(401, "A valid bearer token is required.")
    token = parts[1].strip()
    base = backend_url()
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            response = await client.get(base + "/v1/session", headers={"Authorization": f"Bearer {token}"})
        if response.status_code == 401:
            raise HTTPException(401, "Your session is invalid or expired.")
        if response.status_code != 200:
            raise HTTPException(503, "LocalGo session verification is unavailable.")
        owner = str(UUID(response.json()["user_id"]))
    except (httpx.HTTPError, ValueError, KeyError, TypeError):
        raise HTTPException(503, "LocalGo session verification is unavailable.") from None
    return Session(owner, token, base)
