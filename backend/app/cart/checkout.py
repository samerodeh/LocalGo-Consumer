"""Immutable server-cart checkout snapshots and backend-only lock lifecycle."""
import hashlib
import json
from dataclasses import asdict
from uuid import UUID

from pydantic import BaseModel, Field

from .. import pricing
from ..postgrest import headers
from .models import Cart, CartError
from .repository import SupabaseCartRepository


class Checkout(BaseModel):
    order_id: UUID
    user_id: UUID
    cart_revision: int
    cart: Cart
    tip_cents: int
    status: str
    quote: dict | None = None
    payment_intent_id: str | None = None
    refund_id: str | None = None

    def priced(self) -> pricing.Quote:
        if self.quote is None:
            raise CartError('CHECKOUT_CONFLICT', 'The checkout quote is not prepared.')
        return pricing.Quote(**{**self.quote, 'lines': [pricing.QuoteLine(**line) for line in self.quote['lines']]})

    def fingerprint(self) -> str:
        return hashlib.sha256(json.dumps(self.quote, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class CheckoutRepository:
    def __init__(self):
        self.storage = SupabaseCartRepository()

    async def _rpc(self, path: str, body: dict) -> Checkout:
        response = await self.storage._request('POST', 'rpc/' + path, headers=headers(service=True), json=body)
        try:
            result = response.json()
            if result['status'] != 'ok':
                raise CartError(str(result['status']), 'Checkout changed or is locked. Refresh or reconcile the existing checkout.', 409)
            return Checkout.model_validate(result['checkout'])
        except (ValueError, TypeError, KeyError):
            raise CartError('CART_UNAVAILABLE', 'Checkout storage returned an invalid response.', 503) from None

    async def lock(self, owner: UUID, order_id: UUID, revision: int, tip_cents: int) -> Checkout:
        return await self._rpc('lock_customer_checkout', {'p_user_id': str(owner), 'p_order_id': str(order_id),
                               'p_revision': revision, 'p_tip_cents': tip_cents})

    async def active(self, owner: UUID) -> Checkout | None:
        response = await self.storage._request('GET', 'customer_cart_checkouts', headers=headers(service=True),
            params={'user_id': f'eq.{owner}', 'status': 'eq.pending', 'select': '*',
                    'order': 'created_at.desc', 'limit': '1'})
        rows = response.json()
        return Checkout.model_validate(rows[0]) if rows else None

    async def get(self, owner: UUID, order_id: UUID) -> Checkout:
        response = await self.storage._request('GET', 'customer_cart_checkouts', headers=headers(service=True),
            params={'user_id': f'eq.{owner}', 'order_id': f'eq.{order_id}', 'select': '*', 'limit': '1'})
        rows = response.json()
        if not rows:
            raise CartError('CHECKOUT_NOT_FOUND', 'Checkout not found.', 404)
        try:
            return Checkout.model_validate(rows[0])
        except (ValueError, TypeError, KeyError):
            raise CartError('CART_UNAVAILABLE', 'Checkout storage returned an invalid response.', 503) from None

    async def update(self, record: Checkout, action: str, quote: dict | None = None,
                     payment_id: str | None = None) -> Checkout:
        return await self._rpc('update_customer_checkout', {'p_user_id': str(record.user_id),
            'p_order_id': str(record.order_id), 'p_action': action, 'p_quote': quote, 'p_payment_id': payment_id})

    async def claim_refund(self, record: Checkout) -> Checkout:
        return await self._rpc('claim_customer_checkout_refund', {
            'p_user_id': str(record.user_id), 'p_order_id': str(record.order_id),
            'p_payment_id': record.payment_intent_id})

    async def record_refund(self, record: Checkout, refund_id: str, *, succeeded: bool) -> Checkout:
        return await self._rpc('record_customer_checkout_refund', {
            'p_user_id': str(record.user_id), 'p_order_id': str(record.order_id),
            'p_payment_id': record.payment_intent_id, 'p_refund_id': refund_id,
            'p_succeeded': succeeded})

    async def prepare(self, record: Checkout) -> Checkout:
        if record.quote is not None:
            return record
        try:
            quote = pricing.quote([(line.product_id, line.quantity) for line in record.cart.lines], record.tip_cents)
        except pricing.PricingError:
            await self.update(record, 'release')
            raise CartError('CART_PRICE_CHANGED', 'Menu prices changed. Edit/refresh your cart and start a new checkout.', 409) from None
        if any(line.unit_price_cents != current.unit_price_cents
               for line, current in zip(record.cart.lines, quote.lines)):
            await self.update(record, 'release')
            raise CartError('CART_PRICE_CHANGED', 'Menu prices changed. Edit your cart to reprice it, then confirm again.', 409)
        return await self.update(record, 'prepare', quote=asdict(quote))
