"""Set an existing cart line's quantity."""

from urllib.parse import quote

from pydantic import BaseModel, Field

from goer_localgo.tools.cart.base import CartTool, RevisionInput


class UpdateCartLineInput(RevisionInput):
    product_id: str = Field(min_length=1, max_length=200)
    quantity: int = Field(ge=1, le=99, strict=True)


class UpdateCartLineTool(CartTool):
    name: str = "update_cart_line"
    description: str = "Set an existing product's cart quantity to 1–99 using the latest cart revision. Use remove_cart_line to delete it."
    args_schema: type[BaseModel] = UpdateCartLineInput

    def _run(self, product_id: str, quantity: int, cart_revision: int) -> str:
        return self._call("PATCH", f"/v1/cart/lines/{quote(product_id, safe='')}", {
            "quantity": quantity, "cart_revision": cart_revision,
        })
