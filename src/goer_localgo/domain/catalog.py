"""Catalog data access.

Tools and API routes depend on the ``CatalogRepository`` protocol, not on a
storage format. The JSON implementation serves the bundled LocalGo snapshot;
a Postgres implementation can replace it later via ``set_catalog_repository``.
"""

import copy
import json
from pathlib import Path
from typing import Any, Protocol

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


def get_catalog_repository() -> CatalogRepository:
    return _repository


def set_catalog_repository(repository: CatalogRepository) -> None:
    global _repository
    _repository = repository


def load_catalog() -> list[Product]:
    return _repository.list_products()


def search_products(
    product_name: str,
    merchant_id: str | None = None,
) -> list[Product]:
    query = product_name.strip().lower()
    if not query:
        return []

    return [
        product
        for product in load_catalog()
        if (merchant_id is None or product["merchant_id"] == merchant_id)
        and query in product["name"].lower()
    ]


def merchant_menu(merchant_id: str) -> list[Product]:
    return [
        product
        for product in load_catalog()
        if product["merchant_id"] == merchant_id
    ]


def get_product(product_id: str) -> Product | None:
    return _repository.get_product(product_id)
