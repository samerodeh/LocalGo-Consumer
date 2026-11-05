"""Pure cart validation/pricing. The caller must commit with a revision check."""

import json
from functools import lru_cache
from pathlib import Path

from .. import pricing
from .models import Cart, CartCommand, CartError, CartLine


@lru_cache(maxsize=1)
def merchant_catalog() -> dict[str, str]:
    path = Path(pricing.__file__).parent / "menu_prices.json"
    return {entry["id"]: entry["merchant_id"]
            for entry in json.loads(path.read_text(encoding="utf-8"))}


def apply_command(current: Cart, command: CartCommand) -> Cart:
    if command.cart_revision != current.revision:
        raise CartError("CART_REVISION_CONFLICT", "The cart changed. Refresh it before retrying.")
    items = {line.product_id: line.quantity for line in current.lines}
    product_id = command.product_id
    if command.operation == "clear":
        items = {}
    elif command.operation == "add":
        items[product_id] = items.get(product_id, 0) + command.quantity
    else:
        if product_id not in items:
            raise CartError("CART_LINE_NOT_FOUND", "That product is not in your cart.", 404)
        if command.operation == "remove":
            del items[product_id]
        else:
            items[product_id] = command.quantity
    if not items:
        return Cart(revision=current.revision + 1)
    merchants = {merchant_catalog().get(item_id) for item_id in items}
    if None in merchants or any(item_id not in pricing.PRICES for item_id in items):
        raise CartError("ITEM_UNAVAILABLE", "A product is no longer on the menu.", 422)
    if len(merchants) != 1:
        raise CartError("CART_MERCHANT_MISMATCH", "Clear your cart before adding food from another restaurant.")
    try:
        quote = pricing.quote(list(items.items()), tip_cents=0)
    except pricing.PricingError:
        raise CartError("CART_LIMIT_EXCEEDED", "The cart exceeds the supported quantity or total limits.", 422) from None
    return Cart(
        revision=current.revision + 1, merchant_id=next(iter(merchants)),
        lines=[CartLine(product_id=line.item_id, name=line.name,
                        quantity=line.quantity, unit_price_cents=line.unit_price_cents,
                        line_total_cents=line.line_total_cents) for line in quote.lines],
        subtotal_cents=quote.subtotal_cents, delivery_fee_cents=quote.delivery_fee_cents,
        total_cents=quote.total_cents,
    )
