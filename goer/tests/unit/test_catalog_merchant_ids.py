import pytest

from goer_localgo.domain.catalog import (
    catalog_repository_scope,
    menu_overview,
    merchant_key,
    search_results,
)


class _Repo:
    _products = [
        {"product_id": "p1", "merchant_id": "al-taib", "name": "Cheese Pizza Slice",
         "category": "Pizza", "price_cents": 400, "currency": "CAD"},
        {"product_id": "p2", "merchant_id": "chateau-kabab", "name": "Chicken Pizza",
         "category": "Pizza", "price_cents": 1500, "currency": "CAD"},
    ]

    def list_products(self):
        return [dict(p) for p in self._products]

    def get_product(self, product_id):
        return next((dict(p) for p in self._products if p["product_id"] == product_id), None)


@pytest.mark.parametrize("given", ["al-taib", "Al-Taib", "AL TAIB", " al_taib "])
def test_search_accepts_merchant_display_names(given):
    with catalog_repository_scope(_Repo()):
        result = search_results("pizza", given)
    assert [r["product_id"] for r in result["results"]] == ["p1"]


def test_accented_merchant_name_matches_slug():
    assert merchant_key("Château Kabab") == "chateau-kabab"
    with catalog_repository_scope(_Repo()):
        overview = menu_overview("Château Kabab")
    assert overview["merchant_id"] == "chateau-kabab"
    assert overview["product_count"] == 1


def test_unknown_merchant_still_not_found():
    with catalog_repository_scope(_Repo()):
        assert menu_overview("Pizza Palace") is None
        assert search_results("pizza", "Pizza Palace")["total"] == 0
