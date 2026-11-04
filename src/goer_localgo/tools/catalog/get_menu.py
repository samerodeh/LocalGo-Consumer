"""Browse one merchant's compact menu."""

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from goer_localgo.domain.catalog import menu_overview, merchant_ids
from goer_localgo.tools.catalog.serialization import dump_result, error_result


class GetMenuInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    merchant_id: str = Field(min_length=1, max_length=100)


class GetMenuTool(BaseTool):
    name: str = "get_menu"
    description: str = (
        "Browse one merchant's menu: categories with product IDs, names, and "
        "display prices. Use get_product for descriptions and options."
    )
    args_schema: type[BaseModel] = GetMenuInput

    def _run(self, merchant_id: str) -> str:
        overview = menu_overview(merchant_id)
        if overview is None:
            return error_result(
                "MERCHANT_NOT_FOUND",
                f"No merchant with id {merchant_id!r}.",
                known_merchant_ids=merchant_ids(),
            )
        return dump_result(overview, self.name)
