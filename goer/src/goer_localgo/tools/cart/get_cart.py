"""Read the signed-in customer's server-owned cart."""

from pydantic import BaseModel

from goer_localgo.tools.cart.base import CartInput, CartTool


class GetCartInput(CartInput):
    pass


class GetCartTool(CartTool):
    name: str = "get_cart"
    description: str = "Read the customer's LocalGo cart, exact integer-cent totals, and current revision before edits."
    args_schema: type[BaseModel] = GetCartInput

    def _run(self) -> str:
        return self._call("GET", "/v1/cart")
