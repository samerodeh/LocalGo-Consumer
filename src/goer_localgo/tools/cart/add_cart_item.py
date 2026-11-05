"""Add a product using canonical backend IDs and prices."""

from pydantic import BaseModel, Field

from goer_localgo.tools.cart.base import CartTool, RevisionInput


class AddCartItemInput(RevisionInput):
    product_id: str = Field(min_length=1, max_length=200)
    quantity: int = Field(default=1, ge=1, le=99, strict=True)


class AddCartItemTool(CartTool):
    name: str = "add_cart_item"
    description: str = "Add a product to LocalGo's cart using its exact product_id and the revision from get_cart. Never supply prices."
    args_schema: type[BaseModel] = AddCartItemInput

    def _run(self, product_id: str, cart_revision: int, quantity: int = 1) -> str:
        return self._call("POST", "/v1/cart/lines", {
            "product_id": product_id, "quantity": quantity, "cart_revision": cart_revision,
        })
