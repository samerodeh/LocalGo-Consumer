# Goer LocalGo CrewAI

CrewAI Flow project for Goer's LocalGo menu assistant. The project includes
the LocalGo menu snapshot, typed CrewAI tools, a discovery crew, a FastAPI
adapter, and unit/integration/smoke tests.

## Setup

Requires Python 3.10-3.13, `uv`, and a CrewAI-supported model key.

```powershell
cd goer_localgo
$env:UV_LINK_MODE = "copy"
uv sync
```

Set the model credentials in `.env`. The default agent configuration uses:

```dotenv
OPENAI_API_KEY=your_key_here
MODEL=openai/gpt-4.1-mini
```

The `.env` file is local-only and must never be committed.

## Run

Run the CrewAI Flow:

```powershell
uv run kickoff
```

Start the FastAPI adapter:

```powershell
uv run uvicorn goer_localgo.api.main:app --reload
```

The API exposes `GET /health` and `POST /v1/chat`:

```powershell
Invoke-RestMethod `
  -Uri http://127.0.0.1:8000/v1/chat `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"message":"Find me a sandwich at Al-Taib."}'
```

## LocalGo data and tools

`src/goer_localgo/data_menu.json` is the copied LocalGo catalog snapshot.
`src/goer_localgo/domain/catalog.py` reads that data, while the CrewAI
`SearchMenuTool` and `GetMenuTool` expose validated catalog operations to the
discovery agent.

Tools are intentionally deterministic and do not call the model themselves.
The discovery agent uses the tools through CrewAI, and the Flow coordinates the
turn. Cart, checkout, payment, orders, and dispatch remain future domain
services; no model output is trusted to mutate those systems.

## Tests

Run all repository tests:

```powershell
uv run pytest Tests -q
```

Run each tool smoke test:

```powershell
uv run python src/goer_localgo/tools/try-out-tools/search_menu_smoke.py
uv run python src/goer_localgo/tools/try-out-tools/get_menu_smoke.py
```

Unit tests cover catalog behavior and Pydantic tool validation. Integration
tests cover the FastAPI health and request validation boundaries. Model calls
are not required for these tests.
