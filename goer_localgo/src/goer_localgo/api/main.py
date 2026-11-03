import asyncio

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from goer_localgo.main import run_turn


app = FastAPI(title="Goer LocalGo CrewAI API", version="0.1.0")


class ChatRequest(BaseModel):
    user_id: str = "demo-user"
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    user_id: str
    message: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "framework": "crewai", "api": "fastapi"}


@app.post("/v1/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    try:
        response = await asyncio.to_thread(
            run_turn,
            request.message,
            request.user_id,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail="CrewAI could not complete the request.",
        ) from exc

    return ChatResponse(user_id=request.user_id, message=response)
