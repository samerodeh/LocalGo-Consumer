import json

import httpx
from stub_llm import StubLLM, tool_call, prompt_text

from goer_localgo.crews.cart_crew.cart_crew import CartCrew


EMPTY = {"revision": 0, "merchant_id": None, "currency": "CAD", "lines": [],
         "subtotal_cents": 0, "delivery_fee_cents": 0, "total_cents": 0}
ADDED = {**EMPTY, "revision": 1, "merchant_id": "al-taib", "subtotal_cents": 1100,
         "delivery_fee_cents": 500, "total_cents": 1600, "lines": [{
             "product_id": "cheese-pizza-slice", "name": "Cheese Pizza Slice", "quantity": 2,
             "unit_price_cents": 550, "line_total_cents": 1100,
         }]}


def test_cart_crew_reads_backend_and_returns_plan_without_mutating():
    from goer_localgo.integrations.localgo.cart_client import LocalGoCartClient

    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=EMPTY if request.method == "GET" else ADDED)

    stub = StubLLM(responses=[
        tool_call("get_cart", {}),
        'Final Answer: {"operation":"add","product_id":"cheese-pizza-slice","quantity":2,"text":""}',
    ])
    with httpx.Client(transport=httpx.MockTransport(respond)) as http:
        crew = CartCrew(LocalGoCartClient("http://127.0.0.1:8100", "private-token", client=http), "turn-123").crew()
        crew.agents[0].llm = stub
        result = crew.kickoff(inputs={"user_message": "Add two cheese pizza slices", "conversation_context": "{}"})
    assert result.pydantic.operation == "add"
    assert result.pydantic.quantity == 2
    assert len(requests) == 1
    assert requests[0].method == "GET"
    assert all("private-token" not in prompt_text(call) for call in stub.calls)
    tool_names = {tool.name for tool in crew.agents[0].tools}
    assert tool_names == {"get_cart", "get_product", "search_menu"}
    assert not crew.agents[0].allow_delegation
    assert not crew.cache


def test_cart_mutation_budget_is_shared_and_atomic():
    from concurrent.futures import ThreadPoolExecutor
    from goer_localgo.tools.cart.base import CartMutationBudget

    budget = CartMutationBudget()
    with ThreadPoolExecutor(max_workers=8) as pool:
        claims = list(pool.map(lambda _: budget.claim(), range(20)))
    assert sum(claims) == 1


def test_cart_crew_has_no_payment_or_order_tools():
    crew = CartCrew(client=object(), request_key="turn-123").crew()
    assert len(crew.agents) == 1
    assert all(not any(word in tool.name for word in ("payment", "order", "checkout"))
               for tool in crew.agents[0].tools)
