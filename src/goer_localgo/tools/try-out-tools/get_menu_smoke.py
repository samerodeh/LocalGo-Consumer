import json

from pydantic import ValidationError

from goer_localgo.tools.catalog.get_menu import GetMenuInput, GetMenuTool


def main() -> None:
    tool = GetMenuTool()

    menu = json.loads(tool.run(merchant_id="al-taib"))
    assert menu["merchant_id"] == "al-taib"
    assert menu["product_count"] == sum(len(c["items"]) for c in menu["categories"])
    first_item = menu["categories"][0]["items"][0]
    assert set(first_item) == {"product_id", "name", "display_price"}

    missing = json.loads(tool.run(merchant_id="nowhere"))
    assert missing["error"]["code"] == "MERCHANT_NOT_FOUND"
    assert "al-taib" in missing["error"]["known_merchant_ids"]

    try:
        GetMenuInput.model_validate({"merchant_id": "al-taib", "extra": 1})
    except ValidationError:
        pass
    else:
        raise AssertionError("unknown arguments must be rejected")

    print("get_menu smoke test passed")


if __name__ == "__main__":
    main()
