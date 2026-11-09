"""Retrieve one product's canonical details and options."""

from crewai.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from goer_localgo.domain.catalog import get_product, product_detail
from goer_localgo.tools.catalog.serialization import dump_result, error_result


class GetProductInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str = Field(min_length=1, max_length=200)


class GetProductTool(BaseTool):
    name: str = "get_product"
    description: str = (
        "Get full details for one product by product_id: description, price, "
        "whether notes are allowed, and option groups."
    )
    args_schema: type[BaseModel] = GetProductInput

    def _run(self, product_id: str) -> str:
        product = get_product(product_id)
        if product is None:
            return error_result(
                "PRODUCT_NOT_FOUND",
                f"No product with id {product_id!r}. Use search_menu to find IDs.",
            )
        return dump_result(product_detail(product), self.name)
