import pytest
from pydantic import ValidationError

from app.cart.models import Cart, CartCommand, CartError
from app.cart.service import apply_command


def add(current=None, product_id="cheese-pizza-slice", quantity=2):
    current = current or Cart()
    return apply_command(current, CartCommand(operation="add", product_id=product_id,
                         quantity=quantity, cart_revision=current.revision))


def test_add_is_server_priced_and_does_not_mutate_input():
    original = Cart()
    cart = add(original)
    assert original.revision == 0 and original.lines == []
    assert cart.merchant_id == "al-taib"
    assert cart.subtotal_cents == 1100
    assert cart.delivery_fee_cents == 500
    assert cart.total_cents == 1600
    assert cart.currency == "CAD"
    assert add(cart, quantity=1).lines[0].quantity == 3


def test_set_remove_and_clear():
    cart = add()
    changed = apply_command(cart, CartCommand(operation="set", product_id="cheese-pizza-slice",
                            quantity=1, cart_revision=1))
    assert changed.subtotal_cents == 550
    removed = apply_command(changed, CartCommand(operation="remove", product_id="cheese-pizza-slice",
                            cart_revision=2))
    assert removed == Cart(revision=3)
    assert apply_command(cart, CartCommand(operation="clear", cart_revision=1)) == Cart(revision=2)


@pytest.mark.parametrize("product_id,code", [
    ("ck-hummus", "CART_MERCHANT_MISMATCH"), ("missing", "ITEM_UNAVAILABLE"),
])
def test_mixed_restaurant_and_missing_products_fail(product_id, code):
    with pytest.raises(CartError) as exc:
        add(add(), product_id=product_id)
    assert exc.value.code == code


def test_second_restaurant_is_supported_without_an_existing_cart():
    assert add(product_id="ck-hummus").merchant_id == "chateau-kabab"


def test_stale_revision_and_missing_line_fail():
    with pytest.raises(CartError, match="changed"):
        apply_command(add(), CartCommand(operation="clear", cart_revision=0))
    with pytest.raises(CartError) as exc:
        apply_command(Cart(), CartCommand(operation="remove", product_id="cheese-pizza-slice", cart_revision=0))
    assert exc.value.code == "CART_LINE_NOT_FOUND"


def test_accumulated_quantity_limit_is_enforced():
    with pytest.raises(CartError) as exc:
        add(add(quantity=99), quantity=1)
    assert exc.value.code == "CART_LIMIT_EXCEEDED"


@pytest.mark.parametrize("quantity", [0, -1, 100, 1.5, True, "2"])
def test_invalid_quantities_are_not_coerced(quantity):
    with pytest.raises(ValidationError):
        add(quantity=quantity)


def test_client_prices_and_owner_ids_are_forbidden():
    with pytest.raises(ValidationError):
        CartCommand(operation="add", cart_revision=0, product_id="cheese-pizza-slice",
                    quantity=1, unit_price_cents=1, user_id="victim")
