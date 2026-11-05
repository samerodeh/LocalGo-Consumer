"""Validate a Stripe intent against an immutable, owned server checkout."""
from fastapi import HTTPException
from .checkout import Checkout


def metadata_of(intent) -> dict:
    value = intent.metadata
    if value is None:
        return {}
    return value if isinstance(value, dict) else value.to_dict()


def verify_intent(intent, record: Checkout, *, paid: bool = False):
    metadata = metadata_of(intent)
    quote = record.priced()
    if (metadata.get('order_id') != str(record.order_id)
            or metadata.get('customer_id') != str(record.user_id)
            or metadata.get('cart_revision') != str(record.cart_revision)
            or metadata.get('quote_hash') != record.fingerprint()
            or intent.amount != quote.total_cents
            or str(intent.currency).lower() != 'cad'):
        raise HTTPException(409, 'The payment does not match this customer and cart snapshot.')
    if paid and (intent.status != 'succeeded' or getattr(intent, 'amount_received', 0) != quote.total_cents):
        raise HTTPException(402, 'The exact checkout amount has not been paid.')
