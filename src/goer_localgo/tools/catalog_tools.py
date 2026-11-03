import json
from typing import Type

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from goer_localgo.domain.catalog import merchant_menu, search_products


class SearchMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_name: str = Field(min_length=1, max_length=100)
    merchant_id: str | None = None


class SearchMenuTool(BaseTool):
    name: str = "search_menu"
    description: str = (
        "Search LocalGo menu items by a word or phrase in their name. "
        "Optionally restrict the search to one merchant."
    )
    args_schema: Type[BaseModel] = SearchMenuInput

    def _run(self, product_name: str, merchant_id: str | None = None) -> str:
        return json.dumps(
            search_products(product_name, merchant_id),
            ensure_ascii=False,
        )


class GetMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchant_id: str = Field(min_length=1, max_length=100)


class GetMenuTool(BaseTool):
    name: str = "get_menu"
    description: str = "Retrieve LocalGo menu items for one merchant."
    args_schema: Type[BaseModel] = GetMenuInput

    def _run(self, merchant_id: str) -> str:
        return json.dumps(merchant_menu(merchant_id), ensure_ascii=False)
