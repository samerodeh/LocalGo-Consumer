"""Thin async helper over Supabase's PostgREST endpoint.

The backend is deliberately a *forwarding* proxy for data access: driver
endpoints pass the caller's own Supabase Auth JWT through to PostgREST, so
every row-level-security policy applies exactly as it did when the apps
talked to Supabase directly. The anon key is used where the consumer app used
it (the one-way order insert), and the service-role key only where the old
notify-push edge function used it (deriving push recipients).
"""

import base64
import json
from typing import Any

import httpx

from . import config

REST_URL = f"{config.SUPABASE_URL}/rest/v1"

# One shared client; PostgREST calls are short, streaming is handled elsewhere.
client = httpx.AsyncClient(timeout=15.0)


def headers(
    bearer: str | None = None,
    *,
    service: bool = False,
    prefer: str | None = None,
) -> dict[str, str]:
    """PostgREST headers. `bearer` is the caller's Supabase Auth access token
    (forwarded verbatim so RLS runs as that user). Modern API keys go only
    in `apikey`; legacy JWT keys also use Bearer. `service=True` selects the
    backend secret/service-role key."""
    key = config.SUPABASE_SERVICE_ROLE_KEY if service else config.SUPABASE_ANON_KEY
    h = {
        "apikey": key,
        "Content-Type": "application/json",
    }
    if bearer:
        h["Authorization"] = f"Bearer {bearer}"
    elif not key.startswith(("sb_secret_", "sb_publishable_")):
        h["Authorization"] = f"Bearer {key}"
    if prefer:
        h["Prefer"] = prefer
    return h


def bearer_from(authorization: str | None) -> str | None:
    if not authorization:
        return None
    parts = authorization.split(" ", 1)
    if len(parts) == 2 and parts[0].lower() == "bearer" and parts[1].strip():
        return parts[1].strip()
    return None


def jwt_sub(token: str | None) -> str | None:
    """Best-effort `sub` claim extraction, WITHOUT signature verification —
    it is only used for query filters and rate-limit keys. Authorization is
    enforced by PostgREST itself, which does verify the forwarded token."""
    if not token:
        return None
    try:
        payload_b64 = token.split(".")[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload: dict[str, Any] = json.loads(base64.urlsafe_b64decode(payload_b64))
        sub = payload.get("sub")
        return sub if isinstance(sub, str) and sub else None
    except Exception:
        return None
