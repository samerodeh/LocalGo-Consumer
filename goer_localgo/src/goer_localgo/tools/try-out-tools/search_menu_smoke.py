from goer_localgo.tools.catalog_tools import SearchMenuTool


def main() -> None:
    result = SearchMenuTool().run(product_name="sandwich")
    assert "product_id" in result
    print("search_menu smoke test passed")


if __name__ == "__main__":
    main()
