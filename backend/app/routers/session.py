"""Resolve a customer token without exposing claims or server credentials."""
from typing import Annotated
from fastapi import APIRouter, Depends
from ..auth import CustomerSession, require_customer

router = APIRouter(prefix="/v1/session", tags=["session"])


@router.get("")
async def get_session(customer: Annotated[CustomerSession, Depends(require_customer)]):
    return {"user_id": str(customer.user_id)}
