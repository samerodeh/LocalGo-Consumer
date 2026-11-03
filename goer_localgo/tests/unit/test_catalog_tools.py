import json

from goer_localgo.domain.catalog import search_products
from goer_localgo.tools.catalog_tools import GetMenuInput, SearchMenuTool


def test_search_menu_returns_matching_localgo_products():
    products = search_products("sandwich", merchant_id="al-taib")

    assert products
    assert all(product["merchant_id"] == "al-taib" for product in products)


def test_search_menu_tool_returns_json():
    result = json.loads(SearchMenuTool().run(product_name="shawarma"))

    assert result
    assert result[0]["product_id"]


def test_get_menu_input_validates_merchant():
    result = GetMenuInput.model_validate({"merchant_id": "al-taib"})

    assert result.merchant_id == "al-taib"
