"""Supabase adapter. User JWTs read under RLS; verified server writes use RPC."""

from typing import Protocol
from uuid import UUID

import httpx
from pydantic import ValidationError

from .. import config
from ..postgrest import client, headers
from .models import Cart, CartError


class CartRepository(Protocol):
    async def load(self, user_id: UUID, bearer: str) -> Cart: ...
    async def receipt(self, user_id: UUID, key: str) -> tuple[str, Cart] | None: ...
    async def commit(self, user_id: UUID, revision: int, key: str, request_hash: str, cart: Cart) -> Cart: ...


class SupabaseCartRepository:
    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        if not config.SUPABASE_CONFIGURED or not config.SUPABASE_SERVICE_ROLE_KEY:
            raise CartError("CART_UNAVAILABLE", "Server carts are not configured.", 503)
        try:
            response = await client.request(method, f"{config.SUPABASE_URL}/rest/v1/{path}", **kwargs)
        except httpx.HTTPError:
            raise CartError("CART_UNAVAILABLE", "Cart storage is temporarily unavailable.", 503) from None
        if response.status_code in (401, 403):
            # Do not expose database/key errors or silently fall back to local state.
            raise CartError("CART_UNAVAILABLE", "Cart storage authorization failed.", 503)
        if response.status_code != 200:
            raise CartError("CART_UNAVAILABLE", "Cart storage is unavailable; verify its migration and configuration.", 503)
        return response

    async def load(self, user_id: UUID, bearer: str) -> Cart:
        response = await self._request("GET", "customer_carts", headers=headers(bearer),
                                       params={"user_id": f"eq.{user_id}", "select": "data", "limit": "1"})
        try:
            rows = response.json()
            return Cart.model_validate(rows[0]["data"]) if rows else Cart()
        except (ValueError, TypeError, KeyError, IndexError, ValidationError):
            raise CartError("CART_UNAVAILABLE", "Cart storage returned an invalid response.", 503) from None

    async def receipt(self, user_id: UUID, key: str) -> tuple[str, Cart] | None:
        response = await self._request("GET", "customer_cart_requests", headers=headers(service=True),
                                       params={"user_id": f"eq.{user_id}", "request_key": f"eq.{key}",
                                               "select": "request_hash,data", "limit": "1"})
        try:
            rows = response.json()
            return (rows[0]["request_hash"], Cart.model_validate(rows[0]["data"])) if rows else None
        except (ValueError, TypeError, KeyError, IndexError, ValidationError):
            raise CartError("CART_UNAVAILABLE", "Cart storage returned an invalid response.", 503) from None

    async def commit(self, user_id: UUID, revision: int, key: str, request_hash: str, cart: Cart) -> Cart:
        response = await self._request("POST", "rpc/commit_customer_cart", headers=headers(service=True), json={
            "p_user_id": str(user_id), "p_expected_revision": revision,
            "p_request_key": key, "p_request_hash": request_hash, "p_cart": cart.model_dump(),
        })
        try:
            result = response.json()
            status = result["status"]
            if status == "CART_CHECKOUT_LOCKED":
                raise CartError(status, "Finish or cancel your current checkout before editing the cart.")
            if status == "CART_REVISION_CONFLICT":
                raise CartError(status, "The cart changed. Refresh it before retrying.")
            if status == "IDEMPOTENCY_CONFLICT":
                raise CartError(status, "This request key was already used for another change.")
            if status != "ok":
                raise ValueError("Unknown commit result")
            return Cart.model_validate(result["cart"])
        except (ValueError, TypeError, KeyError, ValidationError):
            raise CartError("CART_UNAVAILABLE", "Cart storage returned an invalid response.", 503) from None
