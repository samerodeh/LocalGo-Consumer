from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CartLine(StrictModel):
    product_id: str
    name: str
    quantity: int = Field(ge=1, le=99, strict=True)
    unit_price_cents: int = Field(ge=0, strict=True)
    line_total_cents: int = Field(ge=0, strict=True)


class Cart(StrictModel):
    revision: int = Field(default=0, ge=0, strict=True)
    merchant_id: str | None = None
    currency: Literal["CAD"] = "CAD"
    lines: list[CartLine] = Field(default_factory=list, max_length=50)
    subtotal_cents: int = Field(default=0, ge=0, strict=True)
    delivery_fee_cents: int = Field(default=0, ge=0, strict=True)
    total_cents: int = Field(default=0, ge=0, strict=True)


class RevisionInput(StrictModel):
    cart_revision: int = Field(ge=0, strict=True)


class AddLineInput(RevisionInput):
    product_id: str = Field(min_length=1, max_length=200)
    quantity: int = Field(default=1, ge=1, le=99, strict=True)


class SetQuantityInput(RevisionInput):
    quantity: int = Field(ge=1, le=99, strict=True)


class CartCommand(StrictModel):
    operation: Literal["add", "set", "remove", "clear"]
    cart_revision: int = Field(ge=0, strict=True)
    product_id: str | None = Field(default=None, min_length=1, max_length=200)
    quantity: int | None = Field(default=None, ge=1, le=99, strict=True)

    @model_validator(mode="after")
    def valid_operation(self):
        if self.operation == "clear":
            if self.product_id is not None or self.quantity is not None:
                raise ValueError("Clear has no product or quantity.")
        elif self.product_id is None:
            raise ValueError("A product ID is required.")
        elif self.operation in ("add", "set") and self.quantity is None:
            raise ValueError("A quantity is required.")
        elif self.operation == "remove" and self.quantity is not None:
            raise ValueError("Remove has no quantity.")
        return self


class CartError(Exception):
    def __init__(self, code: str, message: str, status: int = 409):
        self.code = code
        self.message = message
        self.status = status
        super().__init__(message)
