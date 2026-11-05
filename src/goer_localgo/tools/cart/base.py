"""Private, request-scoped dependencies shared by cart tools."""

import json
import re
from dataclasses import dataclass
from typing import Any

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field, PrivateAttr

from goer_localgo.integrations.localgo.cart_client import CartBackendError, CartClient


class CartInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RevisionInput(CartInput):
    cart_revision: int = Field(ge=0, strict=True)


@dataclass
class CartMutationBudget:
    attempted: bool = False


class CartTool(BaseTool):
    _client: Any = PrivateAttr()
    _request_key: str | None = PrivateAttr(default=None)
    _mutation_budget: Any = PrivateAttr(default=None)

    def __init__(self, *, client: CartClient, request_key: str | None = None,
                 mutation_budget: CartMutationBudget | None = None, **kwargs):
        if request_key is not None and not re.fullmatch(r"[A-Za-z0-9._:-]{1,140}", request_key):
            raise ValueError("A safe server-owned request key is required.")
        super().__init__(**kwargs)
        self._client = client
        self._request_key = request_key
        self._mutation_budget = mutation_budget
        self.cache_function = lambda arguments, result: False

    def _call(self, method: str, path: str, payload: dict | None = None) -> str:
        if method != "GET" and self._request_key is None:
            return json.dumps({"error": {"code": "REQUEST_KEY_REQUIRED",
                                         "message": "A server-owned request key is required for cart changes."}})
        if method != "GET" and self._mutation_budget is not None:
            if self._mutation_budget.attempted:
                return json.dumps({"error": {"code": "CART_ACTION_LIMIT",
                                             "message": "Only one cart change is supported per turn. Ask for the next change separately."}})
            self._mutation_budget.attempted = True
        # One logical change per tool per request. Reusing the same key with
        # different arguments is rejected by LocalGo, not silently re-executed.
        key = f"{self._request_key}:{self.name}" if method != "GET" else None
        try:
            cart = self._client.request(method, path, payload=payload, request_key=key)
            return json.dumps({"cart": cart.model_dump()}, ensure_ascii=False)
        except CartBackendError as exc:
            return json.dumps({"error": {"code": exc.code, "message": exc.message}})
