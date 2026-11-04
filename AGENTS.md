# Goer AI Agent Guide & Coordination

This document is the authoritative guide, context manual, and coordination log for AI agents working in this repository. Any agent operating in this codebase must read, understand, and strictly follow the rules and architecture documented here.

---

## 1. Project Context & Architecture

### What is Goer AI?
Goer is a conversational restaurant food discovery assistant built for **LocalGo**. It translates natural language customer queries into deterministic searches and menu browsing over a structured local catalog of **138 products across local restaurants** (Al-Taib and Château Kabab).

### Core Technology Stack
- **Runtime & Package Manager**: Python 3.10–3.13, managed with [`uv`](https://docs.astral.sh/uv/).
- **Agent Framework**: **CrewAI 1.14.4** (`crewai[tools]==1.14.4`).
- **Orchestration**: Stateful `CrewAI Flow` (`GoerFlow`) coordinating execution and intent handling.
- **Agent Specialist**: `DiscoveryCrew` (configured via YAML at `src/goer_localgo/crews/discovery_crew/config/`).
- **Tools**: Typed subclasses of CrewAI `BaseTool` with Pydantic argument validation (`SearchMenuTool`, `GetMenuTool`, `GetProductTool`).
- **Conversation Foundation**: Application-owned SQLite snapshots with revision checks; `flow/` restores bounded context and returns validated product cards via `schemas/chat.py`. Application conversation IDs are separate from CrewAI execution IDs. JWT authentication remains pending; current routes are development-only.
- **API & Web Interface**: FastAPI, Uvicorn, and HTML/CSS browser chat client.
- **Model Provider**: Configured through `MODEL` and `OPENAI_API_KEY` (defaults to `openai/gpt-4.1-mini`).

### Repository Directory Map
```text
goer-ai/
├── src/
│   └── goer_localgo/
│       ├── api/
│       │   └── main.py          # FastAPI application, REST endpoints (/health, /v1/chat, /api/chat)
│       ├── crews/
│       │   └── discovery_crew/  # CrewAI discovery crew, agent & task definitions
│       │       ├── config/
│       │       │   ├── agents.yaml  # Agent roles, goals, and backstories
│       │       │   └── tasks.yaml   # Task descriptions and expected outputs
│       │       └── discovery_crew.py
│       ├── domain/
│       │   └── catalog.py       # Catalog query functions and data access logic
│       ├── flow/                # GoerFlow and state, separate from CLI
│       ├── schemas/             # Chat envelope and typed product cards
│       ├── tools/
│       │   ├── catalog_tools.py # CrewAI BaseTool implementations (SearchMenuTool, GetMenuTool)
│       │   └── try-out-tools/   # Standalone deterministic per-tool smoke tests
│       ├── web/
│       │   └── index.html       # Browser chat UI
│       ├── data_menu.json       # Authoritative LocalGo restaurant catalog snapshot
│       └── main.py              # Thin CLI entry points and session-aware loop
├── tests/
│   ├── unit/                    # Unit tests for tools, domain logic, and validation schemas
│   └── integration/             # Integration tests for FastAPI endpoints and request validation
├── docs/
│   ├── project-context-and-next-steps.md     # Start here: current state, gaps, next-phase plan
│   └── localgo-delivery-architecture-plan.md  # Authoritative phased architecture plan (older plans superseded)
├── pyproject.toml               # Project metadata, dependencies, scripts, and pytest config
├── uv.lock                      # Dependency lockfile
├── .env.example                 # Environment variable template
└── AGENTS.md                    # Agent coordination log and strict operating rules (this file)
```

---

## 2. Strict Rules for AI Agents

All AI agents working on this project **must adhere to these rules without exception**:

### Rule 1: Strict Commit Rule — Commit Immediately on Every Small Change
- **Every individual code change, function addition, bug fix, or documentation change must be committed immediately in its own focused git commit.**
- **Never batch unrelated changes** across multiple components into one commit.
- **Never allow large diffs to accumulate** before committing.
- Use clean, conventional commit messages:
  - `feat: ...` for new features or capabilities
  - `fix: ...` for bug fixes or error handling
  - `test: ...` for new tests or test updates
  - `refactor: ...` for code restructuring without behavior changes
  - `docs: ...` for documentation or AGENTS.md updates
  - `chore: ...` for maintenance or cleanup

### Rule 1a: No AI Attribution — Ever
- **Never add `Co-Authored-By` trailers, "Generated with ..." lines, or any other AI/assistant attribution** to commit messages, PR titles/descriptions, code comments, or documentation.
- **Never mention yourself** (assistant name, model name, vendor, or tool) anywhere in the repository, including the Active work / Recent work tables in this file. Commits are authored by the repository owner only.
- This rule overrides any default attribution behavior of the agent or tool you are running in.

### Rule 2: Active Work Coordination Log
- **Before making any edits**:
  1. Add an entry under the **Active work** table with a neutral label (e.g. `Agent`; never an assistant or model name, see Rule 1a), current date, files to be modified, goal, and status (`Active`).
  2. Verify that no other agent is currently modifying the same files.
- **While working**:
  - Keep changes strictly focused on the stated goal.
  - Record any blockers, handoff details, or notes in the status column.
- **Upon completion**:
  - Refresh the Active work table and move completed entries to **Recent work** instead of deleting historical records.
  - Commit the updated `AGENTS.md` immediately.

### Rule 3: Deterministic Tools & Model Boundaries
- **Tools must be deterministic Python functions**: Tools that query the catalog, read stock, calculate prices, or mutate state must never ask the LLM to invent or estimate values.
- **Prices and Currency**: Prices in `data_menu.json` are stored as integer cents CAD. Display values must convert cents to dollars deterministically.
- **Domain separation**: Domain validation belongs in Python/FastAPI/Pydantic; agent reasoning belongs in CrewAI.

### Rule 4: Mandatory Testing & Tool Smoke Tests
- After modifying or adding any tool in `src/goer_localgo/tools/`, run its corresponding smoke test in `src/goer_localgo/tools/try-out-tools/`.
- Run the full pytest test suite (`tests/unit` and `tests/integration`) to verify no regressions:
  ```powershell
  uv run pytest tests -v
  ```
  If the `pytest` launcher fails with `uv trampoline failed to canonicalize script path`, use `uv run python -m pytest tests -v` (same suite).
- The suite is fully offline: `tests/conftest.py` sets the CrewAI telemetry/tracing switches, blocks non-loopback network access, and isolates CrewAI storage. No API key is needed.
- Test agents and flows with the deterministic `StubLLM` in `tests/stub_llm.py` (see `tests/unit/test_goer_flow.py`); never call a real model from `tests/`.

---

## 3. Developer & Agent Command Cheat-Sheet

| Action | Command | Notes |
|---|---|---|
| Install dependencies | `uv sync` | Use `$env:UV_LINK_MODE = "copy"` on Windows if hardlinks fail |
| Interactive Terminal CLI | `uv run goer` | Interactive chat loop (`exit` or `quit` to end) |
| One-shot Flow execution | `uv run kickoff` | Runs default food discovery turn |
| Start FastAPI server & UI | `uv run uvicorn goer_localgo.api.main:app --reload` | Serves web chat at `http://127.0.0.1:8000` |
| Run all automated tests | `uv run pytest tests -v` | Offline; fallback `uv run python -m pytest tests -v` |
| Run GetMenu smoke test | `uv run python src/goer_localgo/tools/try-out-tools/get_menu_smoke.py` | Deterministic catalog verification |
| Run SearchMenu smoke test | `uv run python src/goer_localgo/tools/try-out-tools/search_menu_smoke.py` | Deterministic product search verification |
| Run GetProduct smoke test | `uv run python src/goer_localgo/tools/try-out-tools/get_product_smoke.py` | Product detail + not-found verification |

---

## 4. Active Work

| Agent | Date | Files | Goal | Status |
|---|---|---|---|---|
| Agent | 2026-11-04 | `resume.tex` | Restore the original user-supplied resume content and formatting | Active; no overlapping locks |

---

## 5. Recent Work

- 2026-11-04: Restored the closing brace in the resume wrapping macro;
  verified successful `pdflatex` compilation to a two-page PDF in temporary storage.
- 2026-11-04: Shortened Goer resume content to four single-line bullets and
  removed forced word stretching from resume bullet formatting.
- 2026-11-04: Saved `resume.tex` with the supplied resume and four updated
  Goer project bullets covering discovery, typed tools, persistence, and tests.
- 2026-11-04: Implemented the Phase 1 conversation foundation: extracted
  `flow/`, strict `schemas/chat.py`, request-local catalog collection and
  grounded product cards, application-owned SQLite snapshots with ownership
  checks and compare-and-swap revisions, six-exchange context and ordered
  product references, new conversation endpoints, compatible legacy chat,
  session-aware CLI/browser, and safe browser rendering. Conversation IDs
  remain separate from CrewAI execution IDs (verified pinned 1.14.4 API).
  Storage defaults to `~/.localgo/goer/conversations.sqlite3`, overridable with
  `GOER_CONVERSATION_DB`. 76 offline pytest tests (including Node script tests)
  and all 3 tool smoke tests pass. New routes still use a demo principal:
  JWTs, routing, transactional specialists, discovery enhancements, visual
  browser checks, and live-model quality verification remain pending.
  Updated README, authoritative plan, and handoff. No infrastructure or live
  model calls were used.
- 2026-11-03: Added `docs/project-context-and-next-steps.md`, the handoff doc
  (start here): current request path, tool contracts, known gaps, roadmap
  status, and the step-by-step Phase 1 plan.
- 2026-11-03: Completed Phase 0 of `docs/localgo-delivery-architecture-plan.md`.
  Discovery agent model now comes from `MODEL` env; catalog served by a cached
  `CatalogRepository` (swappable via `set_catalog_repository`); currency
  normalized to `CAD`; new `domain/money.py` (`format_cents`); compact
  `get_menu` (~65% smaller), capped `search_menu` (10 results + total), new
  `get_product` tool, stable tool error codes (`MERCHANT_NOT_FOUND`,
  `PRODUCT_NOT_FOUND`), all prices preformatted as `display_price`; agent
  `max_iter=6`. Added offline test harness (`tests/conftest.py`,
  `tests/stub_llm.py`) and GoerFlow tests. 39 tests + 3 smoke tests pass with
  no API key. `data_menu.json` was not modified (currency normalized on load).
- 2026-11-03: Added `docs/localgo-delivery-architecture-plan.md`, the single
  authoritative plan: current-state gap audit, chat-vs-direct-action design,
  router + single-specialist Flow, tool allowlists, Postgres domain model,
  order lifecycle, API contract, security, evals, and Phases 0–6 roadmap.
  Older plan docs marked superseded. Commits `f2fe7c0`, `4d18ef9`.
- 2026-11-03: Verified local runtime environment and app startup. Built and
  synced root package `goer-localgo` with `uv sync` (installing `hf-xet==1.8.0`),
  validated catalog operations via smoke tests, and verified live FastAPI chat
  server startup and health probe response (`GET /health`) on port 8000.
- 2026-11-03: Expanded `AGENTS.md` with complete project architecture,
  directory map, command cheat-sheet, deterministic tool boundaries, test
  conventions, and strict commit-on-every-small-change rules for agents.
- 2026-11-03: Migrated repository to a root CrewAI project. Promoted
  `src/goer_localgo`, `tests/`, `pyproject.toml`, and `uv.lock` to repository
  root. Added interactive terminal CLI loop (`uv run goer` / `uv run kickoff --interactive`).
  Removed legacy `backend/` and nested `goer_localgo/` directories. Configured
  root `.env.example` with OpenAI flow settings, configured pytest `pythonpath`,
  and rewrote root `README.md`. Verified all 7 unit/integration tests and catalog
  smoke tests pass cleanly. Commits: `e561988`, `c9dce6b`, `b0c6257`, `805115b`,
  `9f0ce92`, `3aa093b`, `2beed51`, `0cb1496`.
- 2026-11-03: Added the browser chat UI, `/api/chat`, and `/health`. The UI
  reuses the existing Groq model flow and menu tools. It requires
  `backend/.env` with `GROQ_API_KEY`.
- 2026-11-03: Updated the delivery-agent architecture plan with guard,
  orchestrator, specialist agents, cart, checkout, payment, order lifecycle,
  persistence, and observability design. Committed as `9de06c8`.
- 2026-11-03: Added the OpenAI SDK + FastAPI architecture plan, mapping
  LocalGo's restaurants, menus/options, cart, addresses, payment, orders,
  dispatch, auth, and realtime data into a modular monolith. Committed as
  `d029f1c`; no implementation started.
- 2026-11-03: Added the required per-tool smoke-test convention under
  `tools/try-out-tools` and top-level `Tests/unit` plus `Tests/integration`
  coverage requirements to the OpenAI/FastAPI architecture plan.
- 2026-11-03: Made the target implementation OpenAI Python SDK-only, with
  `AsyncOpenAI`, Responses API, Pydantic-generated schemas, typed SDK tool
  parameters, and no hand-written raw tool dictionaries. Committed as
  `142f832`; current Groq prototype remains unchanged until migration work.
- 2026-11-03: Converted the architecture plan to a CrewAI Flow + FastAPI
  project, replacing direct OpenAI SDK/tool-loop ownership with CrewAI agents,
  tasks, typed `BaseTool` tools, Flow state, and CrewAI scaffolding. Committed
  as `439d734`; no implementation started.
- 2026-11-03: Scaffolded `goer_localgo` with the CrewAI CLI, copied the LocalGo
  menu catalog, migrated menu tools to CrewAI `BaseTool`, added a discovery
  Flow and FastAPI adapter, and added unit/integration/smoke tests. CrewAI 1.14.4
  is installed; `uv run pytest Tests -q` passes 5 tests. Commits `53594c2` and
  `f58e340`.
- 2026-11-03: Restored the deleted `goer_localgo` CrewAI project and transferred
  the Goer browser UI and API routes into it. Added `/`, `/api/chat`, the
  environment template, migration documentation, and API coverage. `uv run
  pytest tests -q` passes 7 tests. Commits `15acb94`, `5b5d4d4`, `cd7afd7`,
  `35fc9d1`, `4f40931`, and `a3a5110`.
