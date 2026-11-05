from cart_smoke_support import run_smoke
from goer_localgo.tools.cart.remove_cart_line import RemoveCartLineTool


if __name__ == "__main__":
    run_smoke(RemoveCartLineTool, {"product_id": "cheese-pizza-slice", "cart_revision": 1},
              "DELETE", "/v1/cart/lines/cheese-pizza-slice")
