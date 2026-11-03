import json

import pytest

from goer_localgo.domain import catalog
from goer_localgo.domain.catalog import (
    JsonCatalogRepository,
    get_catalog_repository,
    get_product,
    search_products,
    set_catalog_repository,
)


@pytest.fixture
def fixture_repository(tmp_path):
    path = tmp_path / "menu.json"
    path.write_text(
        json.dumps(
            [
                {"product_id": "p1", "merchant_id": "m1", "name": "Falafel Wrap",
                 "price_cents": 999, "option_groups": []},
                {"product_id": "p2", "merchant_id": "m2", "name": "Chicken Wrap",
                 "price_cents": 1299, "option_groups": []},
            ]
        ),
        encoding="utf-8",
    )
    original = get_catalog_repository()
    repository = JsonCatalogRepository(path)
    set_catalog_repository(repository)
    yield repository, path
    set_catalog_repository(original)


def test_repository_reads_file_only_once(fixture_repository):
    repository, path = fixture_repository
    assert len(repository.list_products()) == 2

    path.write_text("[]", encoding="utf-8")

    assert len(repository.list_products()) == 2


def test_returned_products_cannot_mutate_cache(fixture_repository):
    repository, _ = fixture_repository
    repository.list_products()[0]["name"] = "Tampered"
    repository.get_product("p1")["price_cents"] = 1

    product = repository.get_product("p1")
    assert product["name"] == "Falafel Wrap"
    assert product["price_cents"] == 999


def test_module_functions_use_configured_repository(fixture_repository):
    assert [p["product_id"] for p in search_products("wrap", "m2")] == ["p2"]
    assert get_product("p1")["name"] == "Falafel Wrap"
    assert get_product("missing") is None


def test_default_repository_serves_localgo_snapshot():
    assert len(catalog.load_catalog()) == 138


def test_currency_is_normalized_to_iso_code(fixture_repository):
    # The fixture omits currency, the snapshot stores "cad": both become "CAD".
    assert {p["currency"] for p in fixture_repository[0].list_products()} == {"CAD"}
    set_catalog_repository(JsonCatalogRepository())
    assert {p["currency"] for p in catalog.load_catalog()} == {"CAD"}
