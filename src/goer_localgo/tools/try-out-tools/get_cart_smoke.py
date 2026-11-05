from cart_smoke_support import run_smoke
from goer_localgo.tools.cart.get_cart import GetCartTool


if __name__ == "__main__":
    run_smoke(GetCartTool, {}, "GET", "/v1/cart")
