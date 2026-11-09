"""Discovery replies use the same catalog facts the customer can open."""

from goer_localgo.domain.response_grounding import ground_discovery_reply
from goer_localgo.schemas.chat import ProductCard, ProductDetailCard, ProductListCard


def product(name: str, price: str, product_id: str) -> ProductCard:
    return ProductCard(product_id=product_id, merchant_id="al-taib", name=name,
                       price_cents=int(price.replace("$", "").replace(".", "")),
                       display_price=price)


def test_list_reply_uses_card_order_names_prices_and_count():
    cards = [ProductListCard(items=[product("Pizza Slice", "$5.50", "pizza"),
                                        product("Garlic Bread", "$4.00", "bread")], total=4)]
    reply = ground_discovery_reply("Sushi is $1.00 and Pizza is $9.00", cards, "pizza")
    assert reply == ("1. Pizza Slice - $5.50\n2. Garlic Bread - $4.00\n"
                     "2 more menu matches are available.")


def test_detail_reply_uses_catalog_description_and_warns_for_dietary_requests():
    cards = [ProductDetailCard(product=product("Veggie Pizza", "$6.50", "veggie"),
                               description="Mozzarella, olives, and peppers.")]
    reply = ground_discovery_reply("It is vegan and costs $2.", cards, "Is it vegan?")
    assert reply.startswith("Veggie Pizza - $6.50. Mozzarella, olives, and peppers.")
    assert "confirm dietary or allergy requirements" in reply
    assert "vegan and costs" not in reply


def test_no_card_keeps_clarifying_question_but_drops_unverified_claims():
    assert ground_discovery_reply("Which restaurant do you mean?", [], "pizza") == (
        "Which restaurant do you mean?")
    for text in ("Cheese Pizza is $1.00.", "We have sushi.",
                 "Would you like the $1.00 pizza?", ""):
        assert ground_discovery_reply(text, [], "pizza").startswith("I couldn't verify")


def test_empty_search_card_never_repeats_model_claim():
    cards = [ProductListCard(items=[], total=0)]
    assert "couldn't find" in ground_discovery_reply("We have sushi for $1.", cards, "sushi")
