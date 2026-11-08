"""Search the catalog by product name or menu category."""

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field, model_validator

from goer_localgo.domain.catalog import parse_budget, search_results
from goer_localgo.tools.catalog.serialization import dump_result


class SearchMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_name: str = Field(default="", max_length=100)
    merchant_id: str | None = None
    budget: str | None = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def valid_search(self):
        if not self.product_name.strip() and self.budget is None:
            raise ValueError("A food term or CAD budget is required.")
        if self.budget is not None:
            parse_budget(self.budget)
        return self


class SearchMenuTool(BaseTool):
    name: str = "search_menu"
    description: str = (
        "Search LocalGo menu items by a food word or phrase in product names, "
        "categories or descriptions (e.g. 'pizza', 'spicy', 'garlic'). "
        "Optionally restrict to a merchant and/or pass the customer's literal "
        "CAD budget, such as 'under $15' or 'up to $15'. A budget-only search "
        "returns lower-priced items first. No dietary or stock claims are implied. "
        "Returns at most 10 results plus the total; display_price is ready to show."
    )
    args_schema: type[BaseModel] = SearchMenuInput

    def _run(self, product_name: str = "", merchant_id: str | None = None,
             budget: str | None = None) -> str:
        return dump_result(search_results(product_name, merchant_id, budget=budget), self.name)
