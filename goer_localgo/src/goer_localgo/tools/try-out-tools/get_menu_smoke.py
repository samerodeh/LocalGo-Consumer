from goer_localgo.tools.catalog_tools import GetMenuTool


def main() -> None:
    result = GetMenuTool().run(merchant_id="al-taib")
    assert "merchant_id" in result
    print("get_menu smoke test passed")


if __name__ == "__main__":
    main()
