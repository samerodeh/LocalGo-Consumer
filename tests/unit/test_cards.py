from concurrent.futures import ThreadPoolExecutor

from goer_localgo.domain.cards import build_cards, collect_catalog_results, shown_product_ids
from goer_localgo.domain.catalog import merchant_menu
from goer_localgo.tools.catalog_tools import GetMenuTool, GetProductTool, SearchMenuTool


def test_search_cards_are_grounded_and_capped():
    with collect_catalog_results() as results:
        SearchMenuTool()._run("a")
    cards = build_cards(results)
    assert len(cards[0].items) == 5
    assert cards[0].total > 5
    for item in cards[0].items:
        assert item.price_cents >= 0
        assert item.display_price.startswith("$")


def test_menu_card_order_matches_tool_categories():
    with collect_catalog_results() as results:
        GetMenuTool()._run("al-taib")
    expected = [item["product_id"] for category in results[0].payload["categories"]
                for item in category["items"]][:5]
    assert shown_product_ids(build_cards(results)) == expected


def test_latest_detail_replaces_list_and_errors_do_not_make_cards():
    product = merchant_menu("al-taib")[0]
    with collect_catalog_results() as results:
        GetMenuTool()._run("al-taib")
        GetProductTool()._run(product["product_id"])
        GetProductTool()._run("missing")
    card = build_cards(results)[0]
    assert card.type == "product_detail"
    assert card.product.product_id == product["product_id"]
    assert card.description == product.get("description", "")


def test_errors_alone_produce_no_card():
    with collect_catalog_results() as results:
        GetMenuTool()._run("missing")
    assert build_cards(results) == []


def test_empty_search_produces_empty_list():
    with collect_catalog_results() as results:
        SearchMenuTool()._run("xyz-no-match")
    assert shown_product_ids(build_cards(results)) == []
    assert build_cards(results)[0].total == 0


def test_collector_is_nested_and_thread_isolated():
    def lookup(merchant):
        with collect_catalog_results() as results:
            GetMenuTool()._run(merchant)
        return build_cards(results)[0].items[0].merchant_id

    with collect_catalog_results() as outer:
        with collect_catalog_results() as inner:
            SearchMenuTool()._run("pizza")
        assert inner
        assert not outer
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert list(pool.map(lookup, ["al-taib", "chateau-kabab"])) == ["al-taib", "chateau-kabab"]
        assert not outer
    # Calls outside a turn must not append to the previous collector.
    SearchMenuTool()._run("pizza")
    assert not outer
