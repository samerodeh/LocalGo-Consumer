"""Synchronous LocalGo cart adapter for CrewAI tools.

A verified customer access token must be supplied by trusted request handling,
never by an LLM argument. LocalGo independently verifies it on every request.
"""

from typing import Protocol
from urllib.parse import urlsplit

import httpx
from pydantic import ValidationError

from goer_localgo.schemas.cart import CartSnapshot


class CartBackendError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class CartClient(Protocol):
    def request(self, method: str, path: str, *, payload: dict | None = None,
                request_key: str | None = None) -> CartSnapshot: ...


class LocalGoCartClient:
    def __init__(self, base_url: str, access_token: str, *, client: httpx.Client | None = None):
        url = urlsplit(base_url)
        if (url.scheme not in ("http", "https") or not url.hostname or url.username or url.password
                or url.query or url.fragment):
            raise ValueError("A trusted LocalGo backend URL is required.")
        if url.scheme == "http" and url.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Remote LocalGo requests require HTTPS.")
        if not access_token.strip():
            raise ValueError("A customer access token is required.")
        self._base_url = base_url.rstrip("/")
        self._access_token = access_token
        self._client = client

    def request(self, method: str, path: str, *, payload: dict | None = None,
                request_key: str | None = None) -> CartSnapshot:
        # No model-controlled absolute URL or redirect may receive the token.
        if (not (path == "/v1/cart" or path.startswith("/v1/cart/"))
                or "?" in path or "#" in path or ".." in path):
            raise CartBackendError("INVALID_CART_REQUEST", "The cart product ID or request path is invalid.")
        headers = {"Authorization": f"Bearer {self._access_token}"}
        if request_key is not None:
            headers["Idempotency-Key"] = request_key
        try:
            if self._client is not None:
                response = self._client.request(method, self._base_url + path, headers=headers,
                                                json=payload, follow_redirects=False)
            else:
                with httpx.Client(timeout=15.0, follow_redirects=False) as client:
                    response = client.request(method, self._base_url + path, headers=headers, json=payload)
        except httpx.HTTPError:
            raise CartBackendError("CART_UNAVAILABLE", "LocalGo cart service is temporarily unavailable.") from None
        if response.status_code == 401:
            raise CartBackendError("AUTHENTICATION_REQUIRED", "Sign in to LocalGo before changing your cart.")
        if response.status_code != 200:
            try:
                detail = response.json().get("detail", {})
            except (ValueError, AttributeError):
                detail = {}
            # Do not relay arbitrary upstream bodies, tokens, or stack traces.
            messages = {
                "CART_REVISION_CONFLICT": "The cart changed. Refresh it before retrying.",
                "CART_MERCHANT_MISMATCH": "Clear your cart before switching restaurants.",
                "CART_CHECKOUT_LOCKED": "Finish or cancel your current checkout before editing the cart.",
                "IDEMPOTENCY_CONFLICT": "This request key was already used for another change.",
                "CART_LINE_NOT_FOUND": "That product is not in your cart.",
                "ITEM_UNAVAILABLE": "That product is not available on LocalGo.",
                "CART_LIMIT_EXCEEDED": "The cart exceeds LocalGo's quantity or total limits.",
            }
            code = detail.get("code") if isinstance(detail, dict) else None
            if isinstance(code, str) and code in messages:
                raise CartBackendError(code, messages[code])
            raise CartBackendError("CART_UNAVAILABLE", "LocalGo could not complete the cart request.")
        try:
            return CartSnapshot.model_validate(response.json())
        except (ValueError, ValidationError):
            raise CartBackendError("INVALID_CART_RESPONSE", "LocalGo returned an invalid cart response.") from None
