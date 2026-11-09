import pytest

from goer_localgo.domain.catalog import catalog_repository_scope, search_results


class _Repo:
    _products = [
        {"product_id": "p1", "merchant_id": "chateau-kabab", "name": "Baklava", "category": "Desserts",
         "price_cents": 600, "currency": "CAD", "description": "Honey, pistachios, and walnuts."},
        {"product_id": "p2", "merchant_id": "chateau-kabab", "name": "Chicken Kabab", "category": "The Grills",
         "price_cents": 1900, "currency": "CAD"},
        {"product_id": "p3", "merchant_id": "al-taib", "name": "Cheese Pizza Slice", "category": "Pizza Slices",
         "price_cents": 550, "currency": "CAD"},
        {"product_id": "p4", "merchant_id": "al-taib", "name": "Garlic Bread", "category": "Pizza Sides",
         "price_cents": 400, "currency": "CAD"},
        {"product_id": "p5", "merchant_id": "al-taib", "name": "Ayran", "category": "Drinks",
         "price_cents": 300, "currency": "CAD"},
    ]

    def list_products(self):
        return [dict(p) for p in self._products]

    def get_product(self, product_id):
        return next((dict(p) for p in self._products if p["product_id"] == product_id), None)


def ids(query, merchant=None, *, budget=None):
    with catalog_repository_scope(_Repo()):
        return [r["product_id"] for r in search_results(query, merchant, budget=budget)["results"]]


def test_category_words_find_products():
    assert ids("desserts") == ["p1"]
    assert ids("dessert") == ["p1"]
    assert ids("drinks", "Al-Taib") == ["p5"]


def test_name_matches_rank_before_category_matches():
    # "pizza" is in p3's name and only in p4's category.
    assert ids("pizza") == ["p3", "p4"]


def test_every_word_must_match_name_or_category():
    assert ids("chicken grills") == ["p2"]
    assert ids("pizza options") == ["p3", "p4"]
    assert ids("chicken desserts") == []


def test_unrelated_query_still_finds_nothing():
    assert ids("sushi") == []


def test_ingredient_only_in_description_is_searchable_after_name_matches():
    assert ids("walnuts") == ["p1"]
    assert ids("pizza") == ["p3", "p4"]


def test_budget_filters_exact_cents_and_preserves_relevance():
    assert ids("pizza", budget="under $5.50") == ["p4"]
    assert ids("pizza", budget="up to $5.50") == ["p3", "p4"]
    assert ids("", budget="up to $6 CAD") == ["p5", "p4", "p3", "p1"]
    assert ids("pizza", "Château Kabab", budget="under $20") == []


@pytest.mark.parametrize("budget", ["$15.999", "about $15", "-$5", "", "$10000"])
def test_ambiguous_or_invalid_budget_is_rejected(budget):
    with pytest.raises(ValueError, match="CAD budget"):
        ids("pizza", budget=budget)
