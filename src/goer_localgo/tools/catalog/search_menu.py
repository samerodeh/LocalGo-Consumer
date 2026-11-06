"""Search the catalog by product name or menu category."""

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from goer_localgo.domain.catalog import search_results
from goer_localgo.tools.catalog.serialization import dump_result


class SearchMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_name: str = Field(min_length=1, max_length=100)
    merchant_id: str | None = None


class SearchMenuTool(BaseTool):
    name: str = "search_menu"
    description: str = (
        "Search LocalGo menu items by a food word or phrase, matched against "
        "product names and menu categories (e.g. 'pizza', 'desserts', 'drinks'). "
        "Optionally restrict the search to one merchant. Returns at most 10 "
        "results plus the total match count; display_price is ready to show."
    )
    args_schema: type[BaseModel] = SearchMenuInput

    def _run(self, product_name: str, merchant_id: str | None = None) -> str:
        return dump_result(search_results(product_name, merchant_id), self.name)
