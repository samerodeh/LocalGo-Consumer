"""Authenticated cart API. No caller-controlled identity, price, or merchant."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Path

from ..auth import CustomerSession, require_customer
from ..cart.manager import mutate_cart
from ..cart.checkout import CheckoutRepository
from ..cart.models import AddLineInput, Cart, CartCommand, CartError, RevisionInput, SetQuantityInput
from ..cart.repository import CartRepository, SupabaseCartRepository

router = APIRouter(prefix="/v1/cart", tags=["cart"])
Customer = Annotated[CustomerSession, Depends(require_customer)]
ProductId = Annotated[str, Path(min_length=1, max_length=200)]
RequestKey = Annotated[str, Header(alias="Idempotency-Key", min_length=1, max_length=200,
                                   pattern=r"^[A-Za-z0-9._:-]+$")]


def cart_repository() -> CartRepository:
    return SupabaseCartRepository()


Repository = Annotated[CartRepository, Depends(cart_repository)]


def cart_problem(error: CartError) -> HTTPException:
    return HTTPException(error.status, detail={"code": error.code, "message": error.message})


async def change(repository: CartRepository, customer: CustomerSession,
                 command: CartCommand, key: str) -> Cart:
    try:
        return await mutate_cart(repository, customer, command, key)
    except CartError as exc:
        raise cart_problem(exc) from None


@router.get("", response_model=Cart)
async def get_cart(customer: Customer, repository: Repository):
    try:
        return await repository.load(customer.user_id, customer.bearer)
    except CartError as exc:
        raise cart_problem(exc) from None


@router.get("/checkout")
async def active_checkout(customer: Customer):
    try:
        record = await CheckoutRepository().active(customer.user_id)
        return {"checkout": None if record is None else {"order_id": str(record.order_id),
                "cart_revision": record.cart_revision, "tip_cents": record.tip_cents, "status": record.status}}
    except CartError as exc:
        raise cart_problem(exc) from None


@router.post("/lines", response_model=Cart)
async def add_cart_line(body: AddLineInput, customer: Customer, repository: Repository, key: RequestKey):
    return await change(repository, customer, CartCommand(operation="add", **body.model_dump()), key)


@router.patch("/lines/{product_id}", response_model=Cart)
async def set_cart_quantity(product_id: ProductId, body: SetQuantityInput,
                            customer: Customer, repository: Repository, key: RequestKey):
    return await change(repository, customer, CartCommand(operation="set", product_id=product_id,
                                                         **body.model_dump()), key)


@router.delete("/lines/{product_id}", response_model=Cart)
async def remove_cart_line(product_id: ProductId, body: RevisionInput,
                           customer: Customer, repository: Repository, key: RequestKey):
    return await change(repository, customer, CartCommand(operation="remove", product_id=product_id,
                                                         **body.model_dump()), key)


@router.post("/clear", response_model=Cart)
async def clear_cart(body: RevisionInput, customer: Customer, repository: Repository, key: RequestKey):
    return await change(repository, customer, CartCommand(operation="clear", **body.model_dump()), key)
