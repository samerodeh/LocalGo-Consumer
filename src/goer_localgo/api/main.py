import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from goer_localgo.api.auth import Session, optional_session, carts_enabled
from goer_localgo.api.guards import CARD_REFUSAL, contains_payment_card_data, turn_limiter
from goer_localgo.domain.turns import TurnPending
from goer_localgo.flow.authenticated import run_authenticated_turn
from goer_localgo.integrations.localgo.cart_client import LocalGoCartClient
from goer_localgo.integrations.localgo.catalog_repository import LocalGoCatalogRepository
from goer_localgo.domain.conversations import ConversationConflict, ConversationNotFound
from goer_localgo.flow.goer_flow import TurnInput, create_conversation, run_conversation_turn
from goer_localgo.llm import warm_up
from goer_localgo.observability import flush, setup_tracing
from goer_localgo.schemas.chat import Card, ChatEnvelope, OpenProductAction


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pay one-time costs (HTTPS client setup, tracing instrumentation) at
    # startup instead of inside the first customer's turn.
    try:
        setup_tracing()
        await asyncio.to_thread(warm_up)
    except Exception as exc:
        logging.getLogger(__name__).warning("Startup warm-up skipped (%s)", type(exc).__name__)
    yield
    flush()


app = FastAPI(title="Goer AI", version="0.1.0", lifespan=lifespan)
origins = [origin.strip() for origin in os.environ.get("GOER_ALLOWED_ORIGINS", "").split(",") if origin.strip()]
if origins:
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"],
                       allow_headers=["Authorization", "Content-Type"], allow_credentials=False)
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


def _principal(session: Session | None, http_request: Request) -> str:
    if session is not None:
        return f"user:{session.user_id}"
    return f"ip:{http_request.client.host if http_request.client else 'unknown'}"


def _enforce_rate_limit(principal: str) -> None:
    wait = turn_limiter.retry_after(principal)
    if wait is not None:
        raise HTTPException(429, "You're sending messages too quickly. Please wait a moment and try again.",
                            headers={"Retry-After": str(wait)})


def _card_refusal(conversation_id: UUID, turn_id: UUID | None) -> ChatEnvelope:
    # Not stored, traced or sent to the model: the message itself is discarded.
    return ChatEnvelope(conversation_id=conversation_id, turn_id=turn_id or uuid4(),
                        text=CARD_REFUSAL, trace_id=uuid4())


@app.post("/v1/conversations", response_model=ConversationResponse, status_code=201)
def new_conversation(session: Session | None = Depends(optional_session)) -> ConversationResponse:
    try:
        return ConversationResponse(conversation_id=create_conversation(session.user_id if session else DEMO_USER_ID))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not create conversation.") from exc


@app.post("/v1/conversations/{conversation_id}/turns", response_model=ChatEnvelope)
async def conversation_turn(conversation_id: UUID, request: TurnRequest, http_request: Request,
                            session: Session | None = Depends(optional_session)) -> ChatEnvelope:
    _enforce_rate_limit(_principal(session, http_request))
    if contains_payment_card_data(request.message):
        return _card_refusal(conversation_id, request.request_id)
    if session is None:
        return await _execute_turn(request.message, conversation_id, DEMO_USER_ID)
    if request.request_id is None:
        raise HTTPException(422, "Authenticated turns require a stable request_id UUID.")
    try:
        return await asyncio.to_thread(
            run_authenticated_turn, request.message, str(conversation_id), str(request.request_id),
            session.user_id, LocalGoCartClient(session.base_url, session.access_token), carts_enabled(),
            LocalGoCatalogRepository(session.base_url),
        )
    except TurnPending as exc:
        raise HTTPException(202, {"code": "TURN_PENDING", "message": str(exc),
                                  "request_id": str(request.request_id)}) from None
    except ConversationNotFound:
        raise HTTPException(404, "Conversation not found.") from None
    except ConversationConflict as exc:
        raise HTTPException(409, str(exc)) from None
    except Exception:
        raise HTTPException(503, "Turn could not complete. Retry with the same request_id.") from None


@app.post("/v1/chat", response_model=ChatResponse)
@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest, http_request: Request,
               session: Session | None = Depends(optional_session)) -> ChatResponse:
    if session is not None:
        raise HTTPException(422, "Use the conversation turns endpoint with a stable request_id when signed in.")
    owner = DEMO_USER_ID
    _enforce_rate_limit(_principal(None, http_request))
    message = _latest_message(request)
    if contains_payment_card_data(message):
        return ChatResponse(user_id=owner, message=CARD_REFUSAL,
                            conversation_id=request.conversation_id or uuid4())
    response = await _execute_turn(message, request.conversation_id, owner)
    return ChatResponse(
        user_id=owner, message=response.text,
        conversation_id=response.conversation_id, cards=response.cards, actions=response.actions,
    )
