"""Verify sessions with Supabase before using privileged backend credentials."""
import httpx
from fastapi import Header, HTTPException
from . import config
from .postgrest import bearer_from, client, headers


async def require_user(authorization: str | None = Header(default=None)) -> tuple[str, str]:
    token = bearer_from(authorization)
    if not token:
        raise HTTPException(401, "Sign in to continue")
    if not config.SUPABASE_CONFIGURED:
        raise HTTPException(503, "Authentication is unavailable")
    try:
        response = await client.get(f"{config.SUPABASE_URL}/auth/v1/user", headers=headers(token))
    except httpx.HTTPError as exc:
        raise HTTPException(503, "Authentication is unavailable") from exc
    if response.status_code in (401, 403):
        raise HTTPException(401, "Your session has expired. Sign in again")
    if response.status_code != 200:
        raise HTTPException(503, "Authentication is unavailable")
    user = response.json()
    if not isinstance(user, dict) or not isinstance(user.get("id"), str) or not user["id"]:
        raise HTTPException(401, "Invalid session")
    return token, user["id"]
