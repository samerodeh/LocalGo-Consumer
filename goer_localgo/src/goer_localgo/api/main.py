import asyncio
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from goer_localgo.main import run_turn


app = FastAPI(title="Goer AI", version="0.1.0")
web_dir = Path(__file__).resolve().parent.parent / "web"


class ChatRequest(BaseModel):
    user_id: str = "demo-user"
    message: str | None = Field(default=None, min_length=1, max_length=4000)
    messages: list[dict[str, Any]] = Field(default_factory=list)


class ChatResponse(BaseModel):
    user_id: str
    message: str


@app.get("/")
def index() -> FileResponse:
    return FileResponse(web_dir / "index.html")


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


@app.post("/v1/chat", response_model=ChatResponse)
@app.post("/api/chat")
async def chat(request: ChatRequest) -> ChatResponse:
    try:
        response = await asyncio.to_thread(
            run_turn,
            _latest_message(request),
            request.user_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="CrewAI could not complete the request.",
        ) from exc

    return ChatResponse(user_id=request.user_id, message=response)
