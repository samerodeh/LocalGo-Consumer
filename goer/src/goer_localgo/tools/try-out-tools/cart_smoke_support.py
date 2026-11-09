"""Offline HTTP contract harness shared by the individual cart smoke tests."""

import json

import httpx
from pydantic import ValidationError

from goer_localgo.integrations.localgo.cart_client import LocalGoCartClient


EMPTY = {"revision": 0, "merchant_id": None, "currency": "CAD", "lines": [],
         "subtotal_cents": 0, "delivery_fee_cents": 0, "total_cents": 0}


def run_smoke(tool_type, arguments, method, path):
    responses = [httpx.Response(200, json=EMPTY), httpx.Response(401, json={})]
    requests = []

    def respond(request):
        requests.append(request)
        return responses.pop(0)

    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        client = LocalGoCartClient("http://127.0.0.1:8100", "smoke-only", client=http)
        tool = tool_type(client=client, request_key="smoke")
        assert json.loads(tool.run(**arguments))["cart"] == EMPTY
        assert requests[0].method == method and requests[0].url.path == path
        assert json.loads(tool.run(**arguments))["error"]["code"] == "AUTHENTICATION_REQUIRED"
        try:
            tool.args_schema.model_validate({**arguments, "user_id": "not-model-controlled"})
        except ValidationError:
            pass
        else:
            raise AssertionError("Owner injection must be rejected")
    print(f"{tool_type.__name__} smoke test passed (offline HTTP contract)")
