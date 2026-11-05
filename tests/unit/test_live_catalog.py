import httpx
import pytest

from goer_localgo.domain.catalog import catalog_repository_scope, get_product, get_catalog_repository
from goer_localgo.integrations.localgo.catalog_repository import LocalGoCatalogRepository

PRODUCT = {'product_id': 'live-only', 'merchant_id': 'al-taib', 'name': 'Live Product',
           'price_cents': 725, 'currency': 'CAD', 'category': 'Live', 'description': 'From LocalGo',
           'allows_notes': False, 'option_groups': [], 'image_url': None}


def test_live_catalog_is_scoped_cached_and_returns_copies():
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=[PRODUCT])
    original = get_catalog_repository()
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        repository = LocalGoCatalogRepository('https://localgo.example', client=client)
        with catalog_repository_scope(repository):
            assert get_product('live-only')['price_cents'] == 725
            altered = repository.list_products()
            altered[0]['price_cents'] = 1
            assert get_product('live-only')['price_cents'] == 725
            assert get_product('cheese-pizza-slice') is None
    assert get_catalog_repository() is original
    assert len(calls) == 1


@pytest.mark.parametrize('payload', [[], [PRODUCT, PRODUCT], [{**PRODUCT, 'price_cents': True}], {'invalid': True}])
def test_invalid_live_catalog_never_falls_back_to_fixture(payload):
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))) as client:
        with pytest.raises(RuntimeError, match='unavailable'):
            LocalGoCatalogRepository('https://localgo.example', client=client).list_products()
