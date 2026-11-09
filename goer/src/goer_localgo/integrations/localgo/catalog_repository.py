"""Request-scoped snapshot of LocalGo's canonical catalog, not a second source of truth."""
import copy
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field


class CatalogEntry(BaseModel):
    model_config = ConfigDict(extra='forbid')
    product_id: str = Field(min_length=1, max_length=200)
    merchant_id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    price_cents: int = Field(ge=0, strict=True)
    currency: Literal['CAD']
    category: str | None = None
    description: str = ''
    allows_notes: bool = False
    option_groups: list[dict] = Field(default_factory=list)
    image_url: str | None = None


class LocalGoCatalogRepository:
    def __init__(self, base_url: str, *, client: httpx.Client | None = None):
        self.base_url = base_url.rstrip('/')
        self.client = client
        self._products: dict[str, dict] | None = None

    def _load(self):
        if self._products is not None:
            return self._products
        try:
            if self.client is not None:
                response = self.client.get(self.base_url + '/v1/catalog/products', follow_redirects=False)
            else:
                with httpx.Client(timeout=15, follow_redirects=False) as client:
                    response = client.get(self.base_url + '/v1/catalog/products')
            response.raise_for_status()
            raw = response.json()
            if not isinstance(raw, list) or not 1 <= len(raw) <= 5000:
                raise ValueError('Invalid catalog size')
            products = [CatalogEntry.model_validate(entry).model_dump() for entry in raw]
            by_id = {entry['product_id']: entry for entry in products}
            if len(by_id) != len(products):
                raise ValueError('Duplicate product IDs')
            self._products = by_id
        except (httpx.HTTPError, ValueError, TypeError):
            raise RuntimeError('The authoritative LocalGo catalog is unavailable.') from None
        return self._products

    def list_products(self) -> list[dict]:
        return copy.deepcopy(list(self._load().values()))

    def get_product(self, product_id: str) -> dict | None:
        return copy.deepcopy(self._load().get(product_id))
