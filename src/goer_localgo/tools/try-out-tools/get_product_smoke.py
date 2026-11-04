import json

from pydantic import ValidationError

from goer_localgo.tools.catalog.get_product import GetProductInput, GetProductTool


def main() -> None:
    tool = GetProductTool()

    product = json.loads(tool.run(product_id="cheese-pizza-slice"))
    assert product["name"] == "Cheese Pizza Slice"
    assert product["display_price"] == "$5.50"
    assert product["currency"] == "CAD"
    assert "option_groups" in product and "description" in product

    missing = json.loads(tool.run(product_id="does-not-exist"))
    assert missing["error"]["code"] == "PRODUCT_NOT_FOUND"

    try:
        GetProductInput.model_validate({"product_id": ""})
    except ValidationError:
        pass
    else:
        raise AssertionError("empty product_id must be rejected")

    print("get_product smoke test passed")


if __name__ == "__main__":
    main()
