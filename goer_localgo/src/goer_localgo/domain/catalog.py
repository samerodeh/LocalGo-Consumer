import json
from pathlib import Path
from typing import Any


CATALOG_PATH = Path(__file__).resolve().parent.parent / "data_menu.json"


def load_catalog() -> list[dict[str, Any]]:
    with CATALOG_PATH.open(encoding="utf-8") as file:
        return json.load(file)


def search_products(
    product_name: str,
    merchant_id: str | None = None,
) -> list[dict[str, Any]]:
    query = product_name.strip().lower()
    if not query:
        return []

    return [
        product
        for product in load_catalog()
        if (merchant_id is None or product["merchant_id"] == merchant_id)
        and query in product["name"].lower()
    ]


def merchant_menu(merchant_id: str) -> list[dict[str, Any]]:
    return [
        product
        for product in load_catalog()
        if product["merchant_id"] == merchant_id
    ]
