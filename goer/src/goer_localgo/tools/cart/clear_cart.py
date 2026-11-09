"""Clear a customer's cart only when explicitly requested."""

from pydantic import BaseModel

from goer_localgo.tools.cart.base import CartTool, RevisionInput


class ClearCartInput(RevisionInput):
    pass


class ClearCartTool(CartTool):
    name: str = "clear_cart"
    description: str = "Clear all cart lines only when the customer explicitly asks. Requires the latest cart revision. Never clear to resolve a restaurant conflict automatically."
    args_schema: type[BaseModel] = ClearCartInput

    def _run(self, cart_revision: int) -> str:
        return self._call("POST", "/v1/cart/clear", {"cart_revision": cart_revision})
