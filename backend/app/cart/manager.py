"""One mutation path shared by REST callers and Goer's HTTP tools."""

import hashlib
import json

from ..auth import CustomerSession
from .models import Cart, CartCommand, CartError
from .repository import CartRepository
from .service import apply_command


async def mutate_cart(repository: CartRepository, session: CustomerSession,
                      command: CartCommand, key: str) -> Cart:
    request_hash = hashlib.sha256(json.dumps(command.model_dump(), sort_keys=True,
                                            separators=(",", ":")).encode()).hexdigest()
    receipt = await repository.receipt(session.user_id, key)
    if receipt is not None:
        saved_hash, saved_cart = receipt
        if saved_hash != request_hash:
            raise CartError("IDEMPOTENCY_CONFLICT", "This request key was already used for another change.")
        return saved_cart
    current = await repository.load(session.user_id, session.bearer)
    if current.revision != command.cart_revision:
        # A duplicate may have committed between the receipt lookup and read.
        receipt = await repository.receipt(session.user_id, key)
        if receipt is not None:
            if receipt[0] != request_hash:
                raise CartError("IDEMPOTENCY_CONFLICT", "This request key was already used for another change.")
            return receipt[1]
    updated = apply_command(current, command)
    # RPC rechecks receipt + revision under a transaction lock. Python's read
    # alone cannot protect against simultaneous requests on different workers.
    return await repository.commit(session.user_id, current.revision, key, request_hash, updated)
