"""Restaurant IDs must be explicit server catalog metadata, not client claims."""

import json
from pathlib import Path

from app import pricing


def test_public_catalog_matches_cart_pricing_and_current_product_ids(client):
    response = client.get('/v1/catalog/products')
    assert response.status_code == 200
    products = {item['product_id']: item for item in response.json()}
    assert products['cheese-pizza-slice']['price_cents'] == pricing.PRICES['cheese-pizza-slice']
    assert products['cheese-pizza-slice']['description'] == 'Sauce, mozzarella.'
    assert products['coke']['category'] == 'Drinks'
    assert 'ck-catering-10' not in products
    assert len(products) == len(pricing.PRICES) == 145


def test_cart_catalog_covers_prices_with_explicit_merchant_ids():
    entries = json.loads((Path(pricing.__file__).parent / "menu_prices.json").read_text(encoding="utf-8"))
    assert {entry["id"] for entry in entries} == set(pricing.PRICES)
    by_id = {entry["id"]: entry for entry in entries}
    assert by_id["cheese-pizza-slice"]["merchant_id"] == "al-taib"
    assert by_id["ck-hummus"]["merchant_id"] == "chateau-kabab"
    assert all(entry["merchant_id"] in {"al-taib", "chateau-kabab"} for entry in entries)
    assert all(type(entry["price_cents"]) is int for entry in entries)
