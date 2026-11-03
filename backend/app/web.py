import json
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from groq import Groq

from app.agent_tools.get_menu import GET_MENU_TOOL, get_menu
from app.agent_tools.search_menu import SEARCH_MENU_TOOL, search_menu
from app.config import GROQ_API_KEY


app = FastAPI(title="Goer AI")
web_dir = Path(__file__).resolve().parent / "web"


class ChatRequest(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(web_dir / "index.html")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "provider": "groq", "model": "openai/gpt-oss-20b"}


@app.post("/api/chat")
def chat(request: ChatRequest) -> dict[str, Any]:
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY is not configured in backend/.env.",
        )

    messages = [
        {
            "role": "system",
            "content": (
                "You are Goer, LocalGo's ordering assistant. "
                "Use search_menu for specific food and get_menu for a merchant menu. "
                "Never invent products or prices. Prices are in cents; display CAD. "
                "Always show the merchant name. Show no more than five products from "
                "a large menu. You cannot place orders yet. Keep answers short."
            ),
        },
        *request.messages,
    ]
    client = Groq(api_key=GROQ_API_KEY, timeout=30.0)

    for _ in range(5):
        response = client.chat.completions.create(
            model="openai/gpt-oss-20b",
            messages=messages,
            tools=[SEARCH_MENU_TOOL, GET_MENU_TOOL],
            tool_choice="auto",
        )
        message = response.choices[0].message
        messages.append(message.model_dump(exclude_none=True))

        if not message.tool_calls:
            return {"message": {"role": "assistant", "content": message.content or ""}}

        for call in message.tool_calls:
            arguments = json.loads(call.function.arguments)
            if call.function.name == "search_menu":
                result = search_menu(
                    product_name=arguments["product_name"],
                    merchant_id=arguments.get("merchant_id"),
                )
            elif call.function.name == "get_menu":
                result = get_menu(merchant_id=arguments["merchant_id"])
            else:
                result = {"error": f"Unknown tool: {call.function.name}"}

            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": call.id,
                    "name": call.function.name,
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )

    return {
        "message": {
            "role": "assistant",
            "content": "I couldn't finish that request. Please try being more specific.",
        }
    }
