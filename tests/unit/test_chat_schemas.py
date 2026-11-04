from uuid import uuid4

import pytest
from pydantic import ValidationError

from goer_localgo.schemas.chat import ChatEnvelope, ProductCard


def envelope(**changes):
    return dict(conversation_id=uuid4(), turn_id=uuid4(), text="Hello", trace_id=uuid4(), **changes)


def test_envelope_round_trips_with_discriminated_cards():
    response = ChatEnvelope(**envelope(cards=[{
        "type": "product_list", "total": 1, "items": [{
            "product_id": "p1", "merchant_id": "m1", "name": "Falafel",
            "price_cents": 550, "display_price": "$5.50",
        }],
    }]))
    assert ChatEnvelope.model_validate_json(response.model_dump_json()) == response
    assert isinstance(response.cards[0].items[0], ProductCard)


@pytest.mark.parametrize("changes", [
    {"cards": [{"type": "invented"}]},
    {"unexpected": True},
    {"cards": [{"type": "product_list", "total": -1, "items": []}]},
])
def test_envelope_rejects_unknown_fields_and_invalid_cards(changes):
    with pytest.raises(ValidationError):
        ChatEnvelope(**envelope(**changes))


@pytest.mark.parametrize("price", [-1, 5.5, "550"])
def test_money_must_be_nonnegative_integer_cents(price):
    with pytest.raises(ValidationError):
        ProductCard(product_id="p1", merchant_id="m1", name="Falafel",
                    price_cents=price, display_price="$5.50")
