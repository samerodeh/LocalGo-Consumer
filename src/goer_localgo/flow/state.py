from typing import Literal

from pydantic import BaseModel, Field

from goer_localgo.schemas.chat import Card, ChatEnvelope


class TurnSummary(BaseModel):
    role: Literal["user", "assistant"]
    text: str = Field(max_length=8000)


class GoerState(BaseModel):
    # Conversation identity is separate from the execution ID CrewAI adds.
    conversation_id: str = ""
    user_id: str = ""
    user_message: str = ""
    recent_turns: list[TurnSummary] = Field(default_factory=list, max_length=12)
    last_shown_product_ids: list[str] = Field(default_factory=list, max_length=5)
    conversation_context: str = ""
    answer: str = ""
    cards: list[Card] = Field(default_factory=list)
    response: ChatEnvelope | None = None
