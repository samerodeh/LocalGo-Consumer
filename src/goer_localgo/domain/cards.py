"""Request-local tool collection and deterministic discovery card assembly."""

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
        # The compact menu omits raw prices. Resolve the first five IDs while
        # collecting, not later, so the cards keep the turn's catalog snapshot.
        ids = [item["product_id"] for category in payload["categories"]
               for item in category["items"]][:5]
        products = [product_detail(p) for pid in ids if (p := get_product(pid)) is not None]
    else:
        return
    results.append(CatalogResult(tool, deepcopy(payload), deepcopy(products)))
    del results[:-10]


def _product_card(product: dict[str, Any]) -> ProductCard:
    fields = ProductCard.model_fields
    return ProductCard.model_validate({key: value for key, value in product.items() if key in fields})


def build_cards(results: list[CatalogResult]) -> list[Card]:
    """One latest successful lookup, in the exact order offered to the user."""
    if not results:
        return []
    result = results[-1]
    if result.tool == "get_product":
        product = result.products[0]
        return [ProductDetailCard(
            product=_product_card(product),
            description=product.get("description", ""),
            allows_notes=product.get("allows_notes", False),
            option_groups=product.get("option_groups", []),
        )]
    return [ProductListCard(
        items=[_product_card(product) for product in result.products],
        total=result.payload.get("total", result.payload.get("product_count", 0)),
    )]


def shown_product_ids(cards: list[Card]) -> list[str]:
    return [product.product_id for card in cards
            for product in (card.items if isinstance(card, ProductListCard)
                            else [card.product] if isinstance(card, ProductDetailCard) else [])]
