"""Compose discovery facts from catalog cards instead of model prose."""

import re

from goer_localgo.schemas.chat import Card, ProductDetailCard, ProductListCard


_PRICE_CLAIM = re.compile(
    r"\$\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*(?:CAD|dollars?)\b",
    re.IGNORECASE,
)
_DIETARY_REQUEST = re.compile(
    r"\b(?:vegan|vegetarian|gluten[- ]free|halal|kosher|allerg(?:y|ies|ic)|"
    r"dairy[- ]free|nut[- ]free)\b",
    re.IGNORECASE,
)
_UNVERIFIED = "I couldn't verify that from the menu. Ask me to search for an item."


def ground_discovery_reply(model_text: str, cards: list[Card], request: str) -> str:
    """Use exact card facts; allow only price-free clarification without cards."""
    if not cards:
        text = model_text.strip()
        if text.endswith("?") and not _PRICE_CLAIM.search(text):
            return text
        return _UNVERIFIED

    card = cards[0]
    if isinstance(card, ProductListCard):
        if not card.items:
            return "I couldn't find a matching menu item. Try another food or restaurant."
        lines = [f"{index}. {item.name} - {item.display_price}"
                 for index, item in enumerate(card.items, start=1)]
        remaining = max(0, card.total - len(card.items))
        if remaining:
            lines.append(f"{remaining} more menu matches are available.")
        reply = "\n".join(lines)
    elif isinstance(card, ProductDetailCard):
        reply = f"{card.product.name} - {card.product.display_price}"
        if card.description.strip():
            reply += f". {card.description.strip()}"
    else:
        return _UNVERIFIED

    if _DIETARY_REQUEST.search(request):
        reply += "\nPlease confirm dietary or allergy requirements with the restaurant."
    return reply
