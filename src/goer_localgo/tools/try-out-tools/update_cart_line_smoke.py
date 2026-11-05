from cart_smoke_support import run_smoke
from goer_localgo.tools.cart.update_cart_line import UpdateCartLineTool


if __name__ == "__main__":
    run_smoke(UpdateCartLineTool, {"product_id": "cheese-pizza-slice", "quantity": 2, "cart_revision": 1},
              "PATCH", "/v1/cart/lines/cheese-pizza-slice")
