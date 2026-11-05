import asyncio
from pathlib import Path
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from goer_localgo.api.auth import Session, optional_session
from goer_localgo.domain.conversations import ConversationConflict, ConversationNotFound
from goer_localgo.flow.goer_flow import TurnInput, create_conversation, run_conversation_turn
from goer_localgo.schemas.chat import Card, ChatEnvelope, OpenProductAction


app = FastAPI(title="Goer AI", version="0.1.0")
web_dir = Path(__file__).resolve().parent.parent / "web"


class ChatRequest(BaseModel):
    user_id: str = "demo-user"
    conversation_id: UUID | None = None
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    messages: list[dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    user_id: str
    message: str
    conversation_id: UUID
    cards: list[Card] = Field(default_factory=list)
    actions: list[OpenProductAction] = Field(default_factory=list)


class ConversationResponse(BaseModel):
    conversation_id: UUID


class TurnRequest(TurnInput):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID | None = None


# Development only: new routes share a demo principal until JWT auth is added.
DEMO_USER_ID = "demo-user"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(web_dir / "index.html")


@app.get("/chat.js", include_in_schema=False)
def chat_script() -> FileResponse:
    return FileResponse(web_dir / "chat.js", media_type="text/javascript")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "framework": "crewai", "api": "fastapi"}


def _latest_message(request: ChatRequest) -> str:
    if request.message:
        return request.message

    for message in reversed(request.messages):
        if message.get("role") == "user" and isinstance(message.get("content"), str):
            return message["content"]

    raise HTTPException(status_code=422, detail="A user message is required.")


async def _execute_turn(
    message: str, conversation_id: UUID | None, user_id: str,
) -> ChatEnvelope:
    try:
        return await asyncio.to_thread(
            run_conversation_turn, message,
            str(conversation_id) if conversation_id else None, user_id,
        )
    except ConversationNotFound as exc:
        raise HTTPException(status_code=404, detail="Conversation not found.") from exc
    except ConversationConflict as exc:
        raise HTTPException(status_code=409, detail="Conversation changed; retry your message.") from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Message must contain 1–4000 characters and not be blank.") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Goer could not complete the request.") from exc


@app.post("/v1/conversations", response_model=ConversationResponse, status_code=201)
def new_conversation(session: Session | None = Depends(optional_session)) -> ConversationResponse:
    try:
        return ConversationResponse(conversation_id=create_conversation(session.user_id if session else DEMO_USER_ID))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not create conversation.") from exc


@app.post("/v1/conversations/{conversation_id}/turns", response_model=ChatEnvelope)
async def conversation_turn(conversation_id: UUID, request: TurnRequest,
                            session: Session | None = Depends(optional_session)) -> ChatEnvelope:
    return await _execute_turn(request.message, conversation_id, session.user_id if session else DEMO_USER_ID)


@app.post("/v1/chat", response_model=ChatResponse)
@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, session: Session | None = Depends(optional_session)) -> ChatResponse:
    owner = session.user_id if session else DEMO_USER_ID
    response = await _execute_turn(
        _latest_message(request), request.conversation_id, owner,
    )
    return ChatResponse(
        user_id=owner, message=response.text,
        conversation_id=response.conversation_id, cards=response.cards, actions=response.actions,
    )
