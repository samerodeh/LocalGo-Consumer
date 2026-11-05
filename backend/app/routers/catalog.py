"""Public canonical product IDs, names and prices shared by app and Goer."""
import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from .. import pricing

router = APIRouter(prefix='/v1/catalog', tags=['catalog'])


@router.get('/products')
def products():
    try:
        entries = json.loads((Path(pricing.__file__).parent / 'menu_prices.json').read_text(encoding='utf-8'))
        return [{ 'product_id': item['id'], 'merchant_id': item['merchant_id'], 'name': item['name'],
                  'category': item.get('category', 'Other'), 'description': item.get('description', ''),
                  'price_cents': item['price_cents'], 'currency': 'CAD', 'option_groups': [],
                  'allows_notes': False, 'image_url': None } for item in entries]
    except (OSError, ValueError, KeyError, TypeError):
        raise HTTPException(503, 'The authoritative catalog is unavailable.') from None
