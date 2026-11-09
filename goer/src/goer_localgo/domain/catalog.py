"""Catalog data access.

Tools and API routes depend on the ``CatalogRepository`` protocol, not on a
storage format. The JSON implementation serves the bundled LocalGo snapshot;
a Postgres implementation can replace it later via ``set_catalog_repository``.
"""

import copy
import json
import re
import unicodedata
from contextlib import contextmanager
from contextvars import ContextVar
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterator, Protocol

from goer_localgo.domain.money import (
    DEFAULT_CURRENCY,
    format_cents,
    normalize_currency,
)


CATALOG_PATH = Path(__file__).resolve().parent.parent / "data_menu.json"

Product = dict[str, Any]


class CatalogRepository(Protocol):
    def list_products(self) -> list[Product]: ...

    def get_product(self, product_id: str) -> Product | None: ...


class JsonCatalogRepository:
    """Loads the JSON catalog once and serves it from memory."""

    def __init__(self, path: Path = CATALOG_PATH) -> None:
        self._path = path
        self._products: list[Product] | None = None
        self._by_id: dict[str, Product] = {}

    def _load(self) -> list[Product]:
        if self._products is None:
            with self._path.open(encoding="utf-8") as file:
                products: list[Product] = json.load(file)
            for product in products:
                # The LocalGo snapshot stores "cad"; expose ISO codes ("CAD").
                product["currency"] = normalize_currency(
                    product.get("currency", DEFAULT_CURRENCY)
                )
            self._by_id = {product["product_id"]: product for product in products}
            self._products = products
        return self._products

    # Callers receive deep copies so they can never mutate the cached catalog.
    def list_products(self) -> list[Product]:
        return copy.deepcopy(self._load())

    def get_product(self, product_id: str) -> Product | None:
        self._load()
        product = self._by_id.get(product_id)
        return copy.deepcopy(product) if product is not None else None


_repository: CatalogRepository = JsonCatalogRepository()
_scoped_repository: ContextVar[CatalogRepository | None] = ContextVar('catalog_repository', default=None)


@contextmanager
def catalog_repository_scope(repository: CatalogRepository) -> Iterator[None]:
    token = _scoped_repository.set(repository)
    try:
        yield
    finally:
        _scoped_repository.reset(token)


def get_catalog_repository() -> CatalogRepository:
    return _scoped_repository.get() or _repository


def set_catalog_repository(repository: CatalogRepository) -> None:
    global _repository
    _repository = repository


def load_catalog() -> list[Product]:
    return get_catalog_repository().list_products()


def merchant_key(value: str) -> str:
    """Canonical comparison key so "Al-Taib", "al taib" and "Château Kabab"
    match the slug IDs ("al-taib", "chateau-kabab") models often paraphrase."""
    ascii_text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def _same_merchant(product: Product, merchant_id: str) -> bool:
    return merchant_key(product["merchant_id"]) == merchant_key(merchant_id)


_SEARCH_FILLER = {"and", "the", "of", "with", "some", "any", "option", "options", "item", "items",
                  "food", "menu", "please", "show", "me", "all"}
_BUDGET_RE = re.compile(
    r"^(?:(under|below|less than|up to|at most|no more than|max|maximum)\s+)?"
    r"\$?(\d{1,4}(?:\.\d{1,2})?)\s*(?:cad)?$", re.IGNORECASE,
)


def parse_budget(budget: str) -> tuple[int, bool]:
    """Return integer cents and whether the quoted limit is exclusive."""
    match = _BUDGET_RE.fullmatch(budget.strip())
    if match is None:
        raise ValueError("Use a CAD budget such as 'under $15' or 'up to $15'.")
    cents = int(Decimal(match.group(2)) * 100)
    return cents, (match.group(1) or "").lower() in {"under", "below", "less than"}


def _search_words(text: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", merchant_key(text).replace("-", " "))
    # Plurals: "desserts" ~ "dessert", "grills" ~ "grill".
    return {w[:-1] if len(w) > 3 and w.endswith("s") else w for w in words}


def search_products(
    product_name: str,
    merchant_id: str | None = None,
    *,
    budget: str | None = None,
) -> list[Product]:
    """Products whose name, category, then description matches the query.

    Ranked: phrase in the name, phrase in the category ("desserts"), then every
    query word in the name/category, then every word in the description-backed
    product text. Catalog order is kept within each rank.
    """
    query = product_name.strip().lower()
    if not query and budget is None:
        return []
    wanted = _search_words(query) - _SEARCH_FILLER
    price_limit, exclusive = parse_budget(budget) if budget is not None else (None, False)

    ranked: list[tuple[int, Product]] = []
    for product in load_catalog():
        if merchant_id is not None and not _same_merchant(product, merchant_id):
            continue
        if price_limit is not None and (product["price_cents"] >= price_limit if exclusive
                                        else product["price_cents"] > price_limit):
            continue
        name, category = product["name"].lower(), (product.get("category") or "").lower()
        description = product.get("description") or ""
        if not query:
            rank = 0
        elif query in name:
            rank = 0
        elif query in category:
            rank = 1
        elif wanted and wanted <= _search_words(f"{name} {category}"):
            rank = 2
        elif wanted and wanted <= _search_words(f"{name} {category} {description}"):
            rank = 3
        else:
            continue
        ranked.append((rank, product))
    if not query:
        return [product for _, product in sorted(ranked, key=lambda pair: pair[1]["price_cents"])]
    return [product for _, product in sorted(ranked, key=lambda pair: pair[0])]


def merchant_menu(merchant_id: str) -> list[Product]:
    return [
        product
        for product in load_catalog()
        if _same_merchant(product, merchant_id)
    ]


def get_product(product_id: str) -> Product | None:
    return get_catalog_repository().get_product(product_id)


def merchant_ids() -> list[str]:
    return sorted({product["merchant_id"] for product in load_catalog()})


# ---------------------------------------------------------------------------
# Compact views for agent tools. Prices are formatted here, in Python, so the
# model never converts cents to dollars itself.
# ---------------------------------------------------------------------------

def product_summary(product: Product) -> Product:
    return {
        "product_id": product["product_id"],
        "merchant_id": product["merchant_id"],
        "name": product["name"],
        "category": product.get("category"),
        "price_cents": product["price_cents"],
        "currency": product["currency"],
        "display_price": format_cents(product["price_cents"], product["currency"]),
        "has_options": bool(product.get("option_groups")),
    }


def product_detail(product: Product) -> Product:
    return {
        **product_summary(product),
        "description": product.get("description", ""),
        "allows_notes": product.get("allows_notes", False),
        "option_groups": product.get("option_groups", []),
        "image_url": product.get("image_url"),
    }


def search_results(
    product_name: str,
    merchant_id: str | None = None,
    limit: int = 10,
    *,
    budget: str | None = None,
) -> Product:
    matches = search_products(product_name, merchant_id, budget=budget)
    return {
        "total": len(matches),
        "returned": min(len(matches), limit),
        "results": [
            {**product_summary(p), "description": p.get("description", "")}
            for p in matches[:limit]
        ],
    }


def menu_overview(merchant_id: str) -> Product | None:
    """Categories with product names and prices; details via get_product."""
    products = merchant_menu(merchant_id)
    if not products:
        return None

    categories: dict[str, list[Product]] = {}
    for product in products:
        categories.setdefault(product.get("category") or "Other", []).append(
            {
                "product_id": product["product_id"],
                "name": product["name"],
                "display_price": format_cents(
                    product["price_cents"], product["currency"]
                ),
            }
        )

    return {
        "merchant_id": products[0]["merchant_id"],
        "product_count": len(products),
        "categories": [
            {"name": name, "items": items} for name, items in categories.items()
        ],
    }
