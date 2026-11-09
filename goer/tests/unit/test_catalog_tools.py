import json

import pytest
from pydantic import ValidationError

from goer_localgo.domain.catalog import menu_overview, search_products
from goer_localgo.tools.catalog_tools import (
    GetMenuInput,
    GetMenuTool,
    GetProductTool,
    SearchMenuTool,
)
from goer_localgo.tools.catalog.search_menu import SearchMenuInput


def test_search_menu_returns_matching_localgo_products():
    products = search_products("sandwich", merchant_id="al-taib")

    assert products
    assert all(product["merchant_id"] == "al-taib" for product in products)


def test_search_menu_tool_returns_capped_summaries():
    result = json.loads(SearchMenuTool().run(product_name="a"))

    assert result["total"] > 10
    assert result["returned"] == len(result["results"]) == 10
    first = result["results"][0]
    assert first["product_id"]
    assert first["currency"] == "CAD"
    assert "image_url" not in first and "option_groups" not in first


def test_search_menu_uses_descriptions_and_literal_budget():
    result = json.loads(SearchMenuTool().run(product_name="spicy", budget="under $10"))
    assert "mexican-pizza-slice" in [item["product_id"] for item in result["results"]]
    assert result["results"] and all(item["price_cents"] < 1000 for item in result["results"])


def test_budget_only_search_is_valid_but_unbounded_search_is_not():
    assert SearchMenuInput.model_validate({"budget": "up to $10"}).product_name == ""
    for payload in ({}, {"product_name": " "}, {"product_name": "pizza", "budget": "about $10"}):
        with pytest.raises(ValidationError):
            SearchMenuInput.model_validate(payload)


def test_get_menu_input_validates_merchant():
    result = GetMenuInput.model_validate({"merchant_id": "al-taib"})

    assert result.merchant_id == "al-taib"


def test_get_menu_input_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        GetMenuInput.model_validate({"merchant_id": "al-taib", "user_id": "x"})


def test_get_menu_groups_every_product_by_category():
    menu = json.loads(GetMenuTool().run(merchant_id="chateau-kabab"))

    assert menu["product_count"] == 73
    assert sum(len(c["items"]) for c in menu["categories"]) == 73


def test_get_menu_is_much_smaller_than_raw_menu():
    from goer_localgo.domain.catalog import merchant_menu

    compact = len(json.dumps(menu_overview("al-taib")))
    raw = len(json.dumps(merchant_menu("al-taib")))
    assert compact < raw / 2


def test_get_menu_unknown_merchant_returns_error_code():
    result = json.loads(GetMenuTool().run(merchant_id="nowhere"))

    assert result["error"]["code"] == "MERCHANT_NOT_FOUND"


def test_get_product_returns_detail_with_display_price():
    product = json.loads(GetProductTool().run(product_id="create-your-bowl-1-kg"))

    assert product["price_cents"] == 2500
    assert product["display_price"] == "$25.00"
    assert product["description"].startswith("Pick up to 10 items")


def test_get_product_unknown_id_returns_error_code():
    result = json.loads(GetProductTool().run(product_id="nope"))

    assert result["error"]["code"] == "PRODUCT_NOT_FOUND"
