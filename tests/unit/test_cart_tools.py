import json

import httpx
import pytest
from pydantic import ValidationError

from goer_localgo.integrations.localgo.cart_client import CartBackendError, LocalGoCartClient
from goer_localgo.tools.cart.add_cart_item import AddCartItemTool
from goer_localgo.tools.cart.clear_cart import ClearCartTool
from goer_localgo.tools.cart.get_cart import GetCartTool
from goer_localgo.tools.cart.remove_cart_line import RemoveCartLineTool
from goer_localgo.tools.cart.update_cart_line import UpdateCartLineTool


EMPTY = {"revision": 0, "merchant_id": None, "currency": "CAD", "lines": [],
         "subtotal_cents": 0, "delivery_fee_cents": 0, "total_cents": 0}
CASES = [
    (GetCartTool, {}, "GET", "/v1/cart"),
    (AddCartItemTool, {"product_id": "cheese-pizza-slice", "quantity": 2, "cart_revision": 0}, "POST", "/v1/cart/lines"),
    (UpdateCartLineTool, {"product_id": "cheese-pizza-slice", "quantity": 2, "cart_revision": 0}, "PATCH", "/v1/cart/lines/cheese-pizza-slice"),
    (RemoveCartLineTool, {"product_id": "cheese-pizza-slice", "cart_revision": 0}, "DELETE", "/v1/cart/lines/cheese-pizza-slice"),
    (ClearCartTool, {"cart_revision": 0}, "POST", "/v1/cart/clear"),
]


@pytest.mark.parametrize("tool_type,args,method,path", CASES)
def test_tools_use_expected_backend_routes_and_hide_credentials(tool_type, args, method, path):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=EMPTY)

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        backend = LocalGoCartClient("http://127.0.0.1:8100", "private-token", client=http)
        tool = tool_type(client=backend, request_key="turn-123")
        output = json.loads(tool.run(**args))
    assert output["cart"] == EMPTY
    assert calls[0].method == method
    assert calls[0].url.path == path
    assert calls[0].headers["Authorization"] == "Bearer private-token"
    assert "private-token" not in repr(tool)
    assert "private-token" not in repr(tool.model_dump())
    assert "private-token" not in str(tool.args_schema.model_json_schema())
    assert not tool.cache_function({}, {})
    if method != "GET":
        assert calls[0].headers["Idempotency-Key"] == f"turn-123:{tool.name}"
        assert json.loads(calls[0].content)["cart_revision"] == 0


@pytest.mark.parametrize("tool_type,args,method,path", CASES)
def test_model_cannot_supply_identity_or_prices(tool_type, args, method, path):
    tool = tool_type(client=object(), request_key="turn-123")
    for extra in [{"user_id": "victim"}, {"access_token": "secret"}, {"price_cents": 1}]:
        with pytest.raises(ValidationError):
            tool.args_schema.model_validate({**args, **extra})


def test_no_mutation_without_server_owned_request_key():
    tool = ClearCartTool(client=object())
    assert json.loads(tool.run(cart_revision=0))["error"]["code"] == "REQUEST_KEY_REQUIRED"


@pytest.mark.parametrize("quantity", [0, -1, 100, 1.5, True, "2"])
def test_quantity_validation_is_strict(quantity):
    with pytest.raises(ValidationError):
        AddCartItemTool(client=object()).args_schema.model_validate({
            "product_id": "pizza", "quantity": quantity, "cart_revision": 0,
        })


@pytest.mark.parametrize("status,payload,code", [
    (401, {}, "AUTHENTICATION_REQUIRED"),
    (409, {"detail": {"code": "CART_REVISION_CONFLICT", "message": "private-token"}}, "CART_REVISION_CONFLICT"),
    (502, {"detail": "private-token"}, "CART_UNAVAILABLE"),
    (502, {"detail": {"code": ["invalid"]}}, "CART_UNAVAILABLE"),
    (200, {"invalid": True}, "INVALID_CART_RESPONSE"),
    (307, {}, "CART_UNAVAILABLE"),
])
def test_upstream_errors_are_safe_and_redirects_not_followed(status, payload, code):
    with httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(status, json=payload))) as http:
        tool = GetCartTool(client=LocalGoCartClient("https://backend.example", "private-token", client=http))
        error = json.loads(tool.run())["error"]
    assert error["code"] == code
    assert "private-token" not in str(error)


def test_adapter_refuses_non_cart_paths_without_network_calls():
    backend = LocalGoCartClient("https://backend.example", "token")
    for path in ["https://other.example/v1/cart", "/v1/cart-secret", "/v1/cart/../orders"]:
        with pytest.raises(ValueError):
            backend.request("GET", path)


def test_network_failure_is_safe():
    def respond(request):
        raise httpx.ConnectError("private-token")

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        tool = GetCartTool(client=LocalGoCartClient("https://backend.example", "private-token", client=http))
        error = json.loads(tool.run())["error"]
    assert error["code"] == "CART_UNAVAILABLE"
    assert "private-token" not in str(error)


@pytest.mark.parametrize("url", ["http://remote.example", "https://u:p@remote.example", "file:///tmp/cart"])
def test_backend_url_cannot_leak_tokens_over_insecure_transport(url):
    with pytest.raises(ValueError):
        LocalGoCartClient(url, "token")
