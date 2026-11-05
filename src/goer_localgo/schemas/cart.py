"""Wire contract for LocalGo's authoritative cart API."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CartLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_id: str
    name: str
    quantity: int = Field(ge=1, le=99, strict=True)
    unit_price_cents: int = Field(ge=0, strict=True)
    line_total_cents: int = Field(ge=0, strict=True)


class CartSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0, strict=True)
    merchant_id: str | None
    currency: Literal["CAD"]
    lines: list[CartLine] = Field(max_length=50)
    subtotal_cents: int = Field(ge=0, strict=True)
    delivery_fee_cents: int = Field(ge=0, strict=True)
    total_cents: int = Field(ge=0, strict=True)
