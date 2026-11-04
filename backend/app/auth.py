"""Verified customer identity for server-owned resources."""

from dataclasses import dataclass, field
from uuid import UUID

import httpx
from fastapi import Header, HTTPException

from . import config
from .postgrest import bearer_from, client


@dataclass(frozen=True)
class CustomerSession:
    user_id: UUID
    bearer: str = field(repr=False)


async def require_customer(authorization: str | None = Header(default=None)) -> CustomerSession:
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "Customer authentication is not configured.")
    token = bearer_from(authorization)
    if not token:
        raise HTTPException(401, "A signed-in customer token is required.")
    try:
        response = await client.get(
            f"{config.SUPABASE_URL}/auth/v1/user",
            headers={"apikey": config.SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
        )
    except httpx.HTTPError:
        raise HTTPException(503, "Session verification is temporarily unavailable.") from None
    if response.status_code in (401, 403):
        raise HTTPException(401, "Your session is invalid or expired.")
    if response.status_code != 200:
        raise HTTPException(503, "Session verification is temporarily unavailable.")
    try:
        user_id = UUID(response.json()["id"])
    except (ValueError, TypeError, KeyError):
        raise HTTPException(503, "Session verification returned an invalid response.") from None
    return CustomerSession(user_id=user_id, bearer=token)
