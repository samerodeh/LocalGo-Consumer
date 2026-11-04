import json
from typing import Any, Type

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from goer_localgo.domain.cards import record_catalog_result
from goer_localgo.domain.catalog import (
    get_product,
    menu_overview,
    merchant_ids,
    product_detail,
    search_results,
)


def _dump(payload: Any, tool: str | None = None) -> str:
    if tool is not None:
        record_catalog_result(tool, payload)
    return json.dumps(payload, ensure_ascii=False)


def _error(code: str, message: str, **details: Any) -> str:
    return _dump({"error": {"code": code, "message": message, **details}})


class SearchMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_name: str = Field(min_length=1, max_length=100)
    merchant_id: str | None = None


class SearchMenuTool(BaseTool):
    name: str = "search_menu"
    description: str = (
        "Search LocalGo menu items by a word or phrase in their name. "
        "Optionally restrict the search to one merchant. Returns at most 10 "
        "results plus the total match count; display_price is ready to show."
    )
    args_schema: Type[BaseModel] = SearchMenuInput

    def _run(self, product_name: str, merchant_id: str | None = None) -> str:
        return _dump(search_results(product_name, merchant_id), self.name)


class GetMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchant_id: str = Field(min_length=1, max_length=100)


class GetMenuTool(BaseTool):
    name: str = "get_menu"
    description: str = (
        "Browse one merchant's menu: categories with product IDs, names, and "
        "display prices. Use get_product for descriptions and options."
    )
    args_schema: Type[BaseModel] = GetMenuInput

    def _run(self, merchant_id: str) -> str:
        overview = menu_overview(merchant_id)
        if overview is None:
            return _error(
                "MERCHANT_NOT_FOUND",
                f"No merchant with id {merchant_id!r}.",
                known_merchant_ids=merchant_ids(),
            )
        return _dump(overview, self.name)


class GetProductInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(min_length=1, max_length=200)


class GetProductTool(BaseTool):
    name: str = "get_product"
    description: str = (
        "Get full details for one product by product_id: description, price, "
        "whether notes are allowed, and option groups."
    )
    args_schema: Type[BaseModel] = GetProductInput

    def _run(self, product_id: str) -> str:
        product = get_product(product_id)
        if product is None:
            return _error(
                "PRODUCT_NOT_FOUND",
                f"No product with id {product_id!r}. Use search_menu to find IDs.",
            )
        return _dump(product_detail(product), self.name)
