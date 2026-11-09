import json
from uuid import uuid4

import pytest

from goer_localgo.domain.conversations import ConversationConflict
from goer_localgo.domain.turns import TurnPending
from goer_localgo.flow import authenticated as flow
from goer_localgo.flow.goer_flow import create_conversation
from goer_localgo.integrations.localgo.cart_client import CartBackendError
from goer_localgo.schemas.cart import CartPlan, CartSnapshot


class Backend:
    def __init__(self):
        self.cart = CartSnapshot(revision=0, merchant_id=None, currency="CAD", lines=[],
                                 subtotal_cents=0, delivery_fee_cents=0, total_cents=0)
        self.receipts = {}
        self.writes = 0
        self.drop_response = False

    def request(self, method, path, *, payload=None, request_key=None):
        if method == "GET":
            return self.cart
        if request_key in self.receipts:
            return self.receipts[request_key]
        assert payload["cart_revision"] == self.cart.revision
        self.writes += 1
        self.cart = CartSnapshot(revision=1, merchant_id="al-taib", currency="CAD",
            lines=[{"product_id": "cheese-pizza-slice", "name": "Cheese Pizza Slice", "quantity": 2,
                    "unit_price_cents": 550, "line_total_cents": 1100}],
            subtotal_cents=1100, delivery_fee_cents=500, total_cents=1600)
        self.receipts[request_key] = self.cart
        if self.drop_response:
            self.drop_response = False
            raise CartBackendError("CART_UNAVAILABLE", "Lost response")
        return self.cart


@pytest.fixture
def setup(monkeypatch):
    calls = []
    monkeypatch.setattr(flow, "classify", lambda *args: "cart")

    def plan(*args):
        calls.append(args)
        return CartPlan(operation="add", product_id="cheese-pizza-slice", quantity=2)

    monkeypatch.setattr(flow, "plan_cart", plan)
    owner = str(uuid4())
    conversation = create_conversation(owner)
    return owner, conversation, Backend(), calls


def test_staged_command_replay_and_history_are_exact(setup):
    owner, conversation, backend, calls = setup
    request = str(uuid4())
    first = flow.run_authenticated_turn("add two", conversation, request, owner, backend, True)
    replay = flow.run_authenticated_turn("add two", conversation, request, owner, backend, True)
    assert replay == first
    assert backend.writes == 1 and len(calls) == 1
    assert first.cards[0].type == "cart_summary"
    assert first.cards[0].display_total == "$16.00"
    assert first.turn_id == uuid4().__class__(request)
    with pytest.raises(ConversationConflict):
        flow.run_authenticated_turn("different message", conversation, request, owner, backend, True)


def test_lost_response_recovers_without_replanning_or_duplicate_add(setup):
    owner, conversation, backend, calls = setup
    request = str(uuid4())
    backend.drop_response = True
    with pytest.raises(TurnPending):
        flow.run_authenticated_turn("add two", conversation, request, owner, backend, True)
    with pytest.raises(ConversationConflict):
        flow.run_authenticated_turn("new message", conversation, str(uuid4()), owner, backend, True)
    result = flow.run_authenticated_turn("add two", conversation, request, owner, backend, True)
    assert result.cards[0].cart.revision == 1
    assert backend.writes == 1 and len(calls) == 1


def test_disabled_cart_does_not_plan_or_write(setup):
    owner, conversation, backend, calls = setup
    result = flow.run_authenticated_turn("add two", conversation, str(uuid4()), owner, backend, False)
    assert "not enabled" in result.text
    assert not calls and backend.writes == 0
