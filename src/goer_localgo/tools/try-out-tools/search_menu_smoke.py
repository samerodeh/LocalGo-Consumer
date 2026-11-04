import json

from pydantic import ValidationError

from goer_localgo.tools.catalog.search_menu import SearchMenuInput, SearchMenuTool


def main() -> None:
    tool = SearchMenuTool()

    found = json.loads(tool.run(product_name="sandwich"))
    assert found["total"] >= found["returned"] > 0
    assert found["returned"] <= 10
    assert found["results"][0]["product_id"]
    assert found["results"][0]["display_price"].startswith("$")

    empty = json.loads(tool.run(product_name="zzz-no-such-dish"))
    assert empty == {"total": 0, "returned": 0, "results": []}

    try:
        SearchMenuInput.model_validate({"product_name": ""})
    except ValidationError:
        pass
    else:
        raise AssertionError("empty product_name must be rejected")

    print("search_menu smoke test passed")


if __name__ == "__main__":
    main()
