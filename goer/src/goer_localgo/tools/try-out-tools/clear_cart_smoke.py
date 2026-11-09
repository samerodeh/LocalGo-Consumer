from cart_smoke_support import run_smoke
from goer_localgo.tools.cart.clear_cart import ClearCartTool


if __name__ == "__main__":
    run_smoke(ClearCartTool, {"cart_revision": 1}, "POST", "/v1/cart/clear")
