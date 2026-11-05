"""Remove one existing product line."""

from urllib.parse import quote

from pydantic import BaseModel, Field

from goer_localgo.tools.cart.base import CartTool, RevisionInput


class RemoveCartLineInput(RevisionInput):
    product_id: str = Field(min_length=1, max_length=200)


class RemoveCartLineTool(CartTool):
    name: str = "remove_cart_line"
    description: str = "Remove an entire existing product line from LocalGo's cart using its exact ID and latest cart revision."
    args_schema: type[BaseModel] = RemoveCartLineInput

    def _run(self, product_id: str, cart_revision: int) -> str:
        return self._call("DELETE", f"/v1/cart/lines/{quote(product_id, safe='')}", {"cart_revision": cart_revision})
