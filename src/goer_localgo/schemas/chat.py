"""Chat cards are built by Python from catalog data, never by the model."""

from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from goer_localgo.schemas.cart import CartSnapshot


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProductCard(StrictModel):
    product_id: str
    merchant_id: str
    name: str
    price_cents: int = Field(ge=0, strict=True)
    currency: Literal["CAD"] = "CAD"
    display_price: str
    image_url: str | None = None
    has_options: bool = False


class ProductListCard(StrictModel):
    type: Literal["product_list"] = "product_list"
    items: list[ProductCard] = Field(max_length=5)
    total: int = Field(ge=0)


class ProductDetailCard(StrictModel):
    type: Literal["product_detail"] = "product_detail"
    product: ProductCard
    description: str = ""
    allows_notes: bool = False
    # The upstream option schema is not established yet; preserve catalog data.
    option_groups: list[dict[str, Any]] = Field(default_factory=list)


class CartSummaryCard(StrictModel):
    type: Literal["cart_summary"] = "cart_summary"
    cart: CartSnapshot
    display_subtotal: str
    display_delivery_fee: str
    display_total: str


Card = Annotated[ProductListCard | ProductDetailCard | CartSummaryCard, Field(discriminator="type")]


class OpenProductAction(StrictModel):
    type: Literal["open_product"] = "open_product"
    label: str = "View details"
    product_id: str


class ChatEnvelope(StrictModel):
    conversation_id: UUID
    turn_id: UUID
    text: str = Field(max_length=8000)
    cards: list[Card] = Field(default_factory=list, max_length=1)
    actions: list[OpenProductAction] = Field(default_factory=list, max_length=5)
    trace_id: UUID
