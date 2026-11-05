"""Authenticated turn coordinator: classify → persist plan → apply → persist reply.

Models have read tools only. Mutations happen only from immutable journal plans.
"""
import hashlib
import json
from uuid import UUID, uuid4

from goer_localgo.crews.cart_crew.cart_crew import CartCrew
from goer_localgo.domain.catalog import get_product
from goer_localgo.domain.money import format_cents
from goer_localgo.domain.turns import TurnJournal, TurnPending
from goer_localgo.flow.goer_flow import GoerFlow, TurnInput
from goer_localgo.flow.routing import classify
from goer_localgo.schemas.cart import CartPlan, CartSnapshot
from goer_localgo.schemas.chat import CartSummaryCard, ChatEnvelope
from goer_localgo.tools.cart.add_cart_item import AddCartItemTool
from goer_localgo.tools.cart.clear_cart import ClearCartTool
from goer_localgo.tools.cart.remove_cart_line import RemoveCartLineTool
from goer_localgo.tools.cart.update_cart_line import UpdateCartLineTool

WRITE_TOOLS = {"add": AddCartItemTool, "set": UpdateCartLineTool,
               "remove": RemoveCartLineTool, "clear": ClearCartTool}


def context_text(snapshot: dict) -> str:
    shown = []
    for index, product_id in enumerate(snapshot.get("last_shown_product_ids", []), 1):
        product = get_product(product_id)
        shown.append({"position": index, "product_id": product_id,
                      "name": product["name"] if product else "Unavailable"})
    return json.dumps({"recent_messages": snapshot.get("recent_turns", []),
                       "last_shown_products": shown}, ensure_ascii=False)


def plan_cart(message: str, context: str, client, request_key: str) -> CartPlan:
    result = CartCrew(client, request_key).crew().kickoff(inputs={
        "user_message": message, "conversation_context": context,
    })
    if not isinstance(result.pydantic, CartPlan):
        raise ValueError("The cart planner did not produce a valid plan.")
    return result.pydantic


def run_authenticated_turn(message: str, conversation_id: str, request_id: str,
                           owner: str, client, cart_enabled: bool) -> ChatEnvelope:
    message = TurnInput(message=message).message
    request_id, conversation_id = str(UUID(request_id)), str(UUID(conversation_id))
    journal = TurnJournal()
    record = journal.begin(owner, conversation_id, request_id, message)
    if record.response:
        return ChatEnvelope.model_validate(record.response)
    key = "chat-" + hashlib.sha256(f"{owner}:{conversation_id}:{request_id}".encode()).hexdigest()
    try:
        if record.plan is None:
            context = context_text(record.context)
            intent = classify(message, context)
            if intent == "discovery":
                flow = GoerFlow()
                flow.kickoff(inputs={"conversation_id": conversation_id, "user_id": owner,
                                     "user_message": message,
                                     "recent_turns": record.context.get("recent_turns", []),
                                     "last_shown_product_ids": record.context.get("last_shown_product_ids", [])})
                response = flow.state.response.model_copy(update={"turn_id": UUID(request_id)})
                journal.stage(record, {"response": response.model_dump(mode="json"),
                                       "shown": list(flow.state.last_shown_product_ids)})
            elif intent == "cart" and cart_enabled:
                cart = client.request("GET", "/v1/cart")
                proposed = plan_cart(message, context + "\nCurrent cart: " + cart.model_dump_json(), client, key)
                command = {"operation": proposed.operation, "product_id": proposed.product_id,
                           "quantity": proposed.quantity, "cart_revision": cart.revision}
                journal.stage(record, {"command": command, "request_key": key,
                                       "cart": cart.model_dump(), "text": proposed.text})
            else:
                text = ("Cart editing is not enabled for this environment." if intent == "cart"
                        else "Checkout, payments, and order support are not available in this assistant yet. Use the app's explicit checkout flow.")
                journal.stage(record, {"text": text})

        plan = record.plan
        if "response" in plan:
            response = ChatEnvelope.model_validate(plan["response"])
        else:
            cards = []
            text = plan.get("text", "")
            if "command" in plan:
                command = plan["command"]
                operation = command["operation"]
                if operation in WRITE_TOOLS and record.result is None:
                    journal.applying(record)
                    tool = WRITE_TOOLS[operation](client=client, request_key=plan["request_key"])
                    arguments = {"cart_revision": command["cart_revision"]}
                    if operation != "clear":
                        arguments["product_id"] = command["product_id"]
                    if operation in ("add", "set"):
                        arguments["quantity"] = command["quantity"]
                    result = json.loads(tool.run(**arguments))
                    if result.get("error", {}).get("code") in (
                        "CART_UNAVAILABLE", "INVALID_CART_RESPONSE", "AUTHENTICATION_REQUIRED",
                    ):
                        raise TurnPending("The cart result is uncertain. Retry this same request ID to reconcile it.")
                    journal.applied(record, result)
                if operation == "clarify":
                    text = text or "Which product and quantity do you mean?"
                else:
                    result = record.result or {"cart": plan["cart"]}
                    if "error" in result:
                        text = result["error"]["message"]
                    else:
                        cart = CartSnapshot.model_validate(result["cart"])
                        cards = [CartSummaryCard(cart=cart,
                            display_subtotal=format_cents(cart.subtotal_cents),
                            display_delivery_fee=format_cents(cart.delivery_fee_cents),
                            display_total=format_cents(cart.total_cents))]
                        count = sum(line.quantity for line in cart.lines)
                        text = ("Your cart is empty." if not count else
                                f"Your cart has {count} items. Total before tip: {format_cents(cart.total_cents)} CAD.")
            response = ChatEnvelope(conversation_id=conversation_id, turn_id=request_id,
                                    text=text, cards=cards, trace_id=uuid4())
        snapshot = dict(record.context)
        snapshot["recent_turns"] = (snapshot.get("recent_turns", []) + [
            {"role": "user", "text": message}, {"role": "assistant", "text": response.text},
        ])[-12:]
        if "shown" in plan:
            snapshot["last_shown_product_ids"] = plan["shown"]
        saved = journal.finish(record, response.model_dump(mode="json"), snapshot)
        return ChatEnvelope.model_validate(saved)
    except Exception:
        # Release the lease but keep the exact plan/result for safe recovery.
        journal.release(record)
        raise
