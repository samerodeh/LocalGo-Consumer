from cart_smoke_support import run_smoke
from goer_localgo.tools.cart.add_cart_item import AddCartItemTool


if __name__ == "__main__":
    run_smoke(AddCartItemTool, {"product_id": "cheese-pizza-slice", "quantity": 2, "cart_revision": 0},
              "POST", "/v1/cart/lines")
