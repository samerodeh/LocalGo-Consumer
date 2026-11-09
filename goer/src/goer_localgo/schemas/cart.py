"""Wire contract for LocalGo's authoritative cart API."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CartPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    operation: Literal["view", "add", "set", "remove", "clear", "clarify"]
    product_id: str | None = Field(default=None, min_length=1, max_length=200)
    quantity: int | None = Field(default=None, ge=1, le=99, strict=True)
    text: str = Field(default="", max_length=500)

    @model_validator(mode="after")
    def validate_operation(self):
        if self.operation in ("add", "set", "remove") and not self.product_id:
            raise ValueError("An exact product ID is required.")
        if self.operation in ("add", "set") and self.quantity is None:
            raise ValueError("A quantity is required.")
        if self.operation not in ("add", "set") and self.quantity is not None:
            raise ValueError("This operation has no quantity.")
        if self.operation in ("clear", "view", "clarify") and self.product_id is not None:
            raise ValueError("This operation has no product ID.")
        return self


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
