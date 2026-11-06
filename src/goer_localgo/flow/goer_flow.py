import json
import logging
from uuid import UUID, uuid4

from crewai.flow import Flow, listen, start
from pydantic import BaseModel, Field, field_validator

from goer_localgo.crews.discovery_crew.discovery_crew import DiscoveryCrew
from goer_localgo.domain.cards import build_cards, collect_catalog_results, shown_product_ids
from goer_localgo.domain.catalog import get_product
from goer_localgo.domain.conversations import get_conversation_repository
from goer_localgo.flow.state import GoerState, TurnSummary
from goer_localgo.schemas.chat import ChatEnvelope, OpenProductAction, ProductListCard


logger = logging.getLogger(__name__)


class TurnInput(BaseModel):
    message: str = Field(min_length=1, max_length=4000)

    @field_validator("message")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("A user message is required.")
        return value


class GoerFlow(Flow[GoerState]):
    @start()
    def load_context(self):
        products = []
        for index, product_id in enumerate(self.state.last_shown_product_ids, start=1):
            product = get_product(product_id)
            products.append({"position": index, "product_id": product_id,
                             "name": product["name"] if product else "Unavailable"})
        self.state.conversation_context = json.dumps({
            "recent_messages": [turn.model_dump() for turn in self.state.recent_turns],
            "last_shown_products": products,
        }, ensure_ascii=False)

    @listen(load_context)
    def answer_turn(self):
        with collect_catalog_results() as results:
            try:
                result = DiscoveryCrew().crew().kickoff(inputs={
                    "user_message": self.state.user_message,
                    "conversation_context": self.state.conversation_context,
                })
                self.state.answer = result.raw[:8000]
            except Exception as exc:
                # Never expose provider errors, credentials, or prompt contents.
                logger.warning("Discovery turn failed (%s)", type(exc).__name__)
                self.state.answer = "I couldn't finish that request. Please try again; here is anything I found."
            self.state.cards = build_cards(results, self.state.user_message)

    @listen(answer_turn)
    def compose_response(self):
        # CrewAI 1.14 wraps lists; materialize before Pydantic serialization.
        cards = list(self.state.cards)
        ids = shown_product_ids(cards)
        # Preserve references through clarifications, but an empty search clears
        # them because the new displayed list is explicitly empty.
        if self.state.cards:
            self.state.last_shown_product_ids = ids
        actions = [OpenProductAction(product_id=product.product_id)
                   for card in self.state.cards if isinstance(card, ProductListCard)
                   for product in card.items]
        self.state.response = ChatEnvelope(
            conversation_id=self.state.conversation_id, turn_id=uuid4(),
            text=self.state.answer, cards=cards, actions=actions,
            trace_id=uuid4(),
        )
        self.state.recent_turns = (self.state.recent_turns + [
            TurnSummary(role="user", text=self.state.user_message),
            TurnSummary(role="assistant", text=self.state.answer),
        ])[-12:]
        return self.state.response


def create_conversation(user_id: str = "demo-user") -> str:
    return get_conversation_repository().create(user_id).id


def run_conversation_turn(
    user_message: str,
    conversation_id: str | None = None,
    user_id: str = "demo-user",
) -> ChatEnvelope:
    message = TurnInput(message=user_message).message
    repository = get_conversation_repository()
    if conversation_id is None:
        conversation = repository.create(user_id)
    else:
        conversation = repository.load(str(UUID(conversation_id)), user_id)
    flow = GoerFlow()
    flow.kickoff(inputs={
        "conversation_id": conversation.id, "user_id": user_id, "user_message": message,
        "recent_turns": conversation.snapshot.get("recent_turns", []),
        "last_shown_product_ids": conversation.snapshot.get("last_shown_product_ids", []),
    })
    response = flow.state.response
    if response is None:
        raise RuntimeError("Discovery flow did not produce a response.")
    repository.save(conversation, {
        "recent_turns": [turn.model_dump() for turn in flow.state.recent_turns],
        "last_shown_product_ids": list(flow.state.last_shown_product_ids),
    })
    return response


def run_turn(
    user_message: str, user_id: str = "demo-user", conversation_id: str | None = None,
) -> str:
    """Backward-compatible text entry point; supply an ID to retain context."""
    return run_conversation_turn(user_message, conversation_id, user_id).text
