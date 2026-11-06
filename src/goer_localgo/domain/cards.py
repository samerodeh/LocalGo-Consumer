"""Request-local tool collection and deterministic discovery card assembly."""

import re
from contextlib import contextmanager
from contextvars import ContextVar
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Iterator

from goer_localgo.domain.catalog import get_product, product_detail
from goer_localgo.schemas.chat import Card, ProductCard, ProductDetailCard, ProductListCard


@dataclass
class CatalogResult:
    tool: str
    payload: dict[str, Any]
    products: list[dict[str, Any]]


_results: ContextVar[list[CatalogResult] | None] = ContextVar("catalog_results", default=None)


@contextmanager
def collect_catalog_results() -> Iterator[list[CatalogResult]]:
    results: list[CatalogResult] = []
    token = _results.set(results)
    try:
        yield results
    finally:
        _results.reset(token)


def record_catalog_result(tool: str, payload: dict[str, Any]) -> None:
    results = _results.get()
    if results is None or "error" in payload:
        return
    if tool == "search_menu":
        products = payload["results"][:5]
    elif tool == "get_product":
        products = [payload]
    elif tool == "get_menu":
        # The compact menu omits raw prices. Resolve IDs while collecting, not
        # later, so the cards keep the turn's catalog snapshot. All menu items
        # are kept so build_cards can narrow them to what the user asked for.
        ids = [item["product_id"] for category in payload["categories"]
               for item in category["items"]]
        products = [product_detail(p) for pid in ids if (p := get_product(pid)) is not None]
    else:
        return
    results.append(CatalogResult(tool, deepcopy(payload), deepcopy(products)))
    del results[:-10]


def _product_card(product: dict[str, Any]) -> ProductCard:
    fields = ProductCard.model_fields
    return ProductCard.model_validate({key: value for key, value in product.items() if key in fields})


_STOPWORDS = {"show", "me", "the", "a", "an", "some", "any", "what", "options", "option",
               "menu", "please", "can", "you", "at", "from", "for", "with", "and", "or",
               "do", "does", "have", "has", "is", "are", "i", "want", "like", "see", "get"}


def _terms(text: str) -> set[str]:
    words = {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 3 and w not in _STOPWORDS}
    # Cheap singular form so "pizzas"/"slices" match "pizza"/"slice".
    return words | {w[:-1] for w in words if w.endswith("s") and len(w) > 3}


def _matching_menu_items(products: list[dict[str, Any]], query: str | None) -> list[dict[str, Any]]:
    """Menu items whose name or category mentions what the user asked about."""
    wanted = _terms(query or "")
    if not wanted:
        return []
    return [p for p in products
            if wanted & _terms(f"{p.get('name', '')} {p.get('category') or ''}")]


def _pick_result(results: list[CatalogResult]) -> CatalogResult:
    """Latest focused lookup (search/detail) with products beats a full menu dump;
    a full menu is used only when nothing more specific found products. If every
    lookup came back empty, the latest one stands so references are cleared."""
    for tools in (("search_menu", "get_product"), ("get_menu",)):
        for result in reversed(results):
            if result.tool in tools and result.products:
                return result
    return results[-1]


def build_cards(results: list[CatalogResult], query: str | None = None) -> list[Card]:
    """One lookup's products, in the exact order offered to the user."""
    if not results:
        return []
    result = _pick_result(results)
    if result.tool == "get_product":
        product = result.products[0]
        return [ProductDetailCard(
            product=_product_card(product),
            description=product.get("description", ""),
            allows_notes=product.get("allows_notes", False),
            option_groups=product.get("option_groups", []),
        )]
    products, total = result.products, result.payload.get("total", result.payload.get("product_count", 0))
    if result.tool == "get_menu":
        matching = _matching_menu_items(products, query)
        if matching:
            products, total = matching, len(matching)
    return [ProductListCard(
        items=[_product_card(product) for product in products[:5]],
        total=total,
    )]


def shown_product_ids(cards: list[Card]) -> list[str]:
    return [product.product_id for card in cards
            for product in (card.items if isinstance(card, ProductListCard)
                            else [card.product] if isinstance(card, ProductDetailCard) else [])]
