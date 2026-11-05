# Goer AI Agent Guide & Coordination

This document is the authoritative guide, context manual, and coordination log for AI agents working in this repository. Any agent operating in this codebase must read, understand, and strictly follow the rules and architecture documented here.

---

## 1. Project Context & Architecture

### What is Goer AI?
Goer is a conversational food discovery and cart-planning assistant built for **LocalGo**. Guest/demo discovery uses a **138-product fixture** (Al-Taib and Château Kabab); authenticated discovery uses LocalGo's **145-product canonical catalog**. The integration is implemented in code but is **not yet an activated, verified end-to-end customer experience**.

### Core Technology Stack
- **Runtime & Package Manager**: Python 3.10–3.13, managed with [`uv`](https://docs.astral.sh/uv/).
- **Agent Framework**: **CrewAI 1.14.4** (`crewai[tools]==1.14.4`).
- **Orchestration**: Stateful `CrewAI Flow` (`GoerFlow`) coordinating execution and intent handling.
- **Agent Specialists**: `DiscoveryCrew` handles discovery. Feature-gated authenticated routing selects it or read-only `CartCrew`, which produces typed plans. Python journals and executes cart writes after planning; no agent has checkout/payment/order permissions.
- **Tools**: Typed subclasses of CrewAI `BaseTool` with Pydantic argument validation (`SearchMenuTool`, `GetMenuTool`, `GetProductTool`). Keep each tool and its input schema in its own file, grouped by capability (currently `tools/catalog/`); shared helpers belong in separate modules. `tools/catalog_tools.py` is compatibility imports only.
- **Conversation Foundation**: Application-owned SQLite snapshots and a fenced durable turn journal. Signed-in identity is verified through LocalGo's Supabase session endpoint, never body IDs. Stable request UUIDs replay completed responses or reconcile immutable commands; tokens stay out of state/prompts. Guest/demo and authenticated conversations are separate. Live activation and multi-host persistence remain gated.
- **API & Web Interface**: FastAPI/Uvicorn; guest browser/CLI retained. Flagged signed-in LocalGo mobile chat/buttons share its server cart and explicit revision-bound checkout. Read `docs/cart-integration-runbook.md` before activation; templates leave flags false.
- **Model Provider**: Configured through `MODEL` and `OPENAI_API_KEY` (defaults to `openai/gpt-4.1-mini`).

### Repository Directory Map
```text
goer-ai/
├── src/
│   └── goer_localgo/
│       ├── api/
│       │   └── main.py          # FastAPI application, REST endpoints (/health, /v1/chat, /api/chat)
│       ├── crews/
│       │   ├── discovery_crew/  # CrewAI discovery crew, agent & task definitions
│       │       ├── config/
│       │       │   ├── agents.yaml  # Agent roles, goals, and backstories
│       │       │   └── tasks.yaml   # Task descriptions and expected outputs
│       │       └── discovery_crew.py
│       │   └── cart_crew/       # Read-only tools; typed cart plans
│       ├── domain/
│       │   ├── catalog.py       # Scoped JSON/live catalog repositories
│       │   ├── conversations.py # Owned snapshots
│       │   └── turns.py         # Immutable plans, fencing and replay
│       ├── integrations/localgo/ # Authenticated cart HTTP / canonical catalog
│       ├── flow/                # GoerFlow and state, separate from CLI
│       ├── schemas/             # Chat envelope and typed product cards
│       ├── tools/
│       │   ├── catalog_tools.py # Compatibility imports only
│       │   ├── catalog/         # One read tool per file
│       │   ├── cart/            # One cart tool per file; Flow-owned writes
│       │   └── try-out-tools/   # Standalone deterministic per-tool smoke tests
│       ├── web/
│       │   └── index.html       # Browser chat UI
│       ├── data_menu.json       # Guest/demo fixture, not the live catalog authority
│       └── main.py              # Thin CLI entry points and session-aware loop
├── tests/
│   ├── unit/                    # Unit tests for tools, domain logic, and validation schemas
│   └── integration/             # Integration tests for FastAPI endpoints and request validation
├── docs/
│   ├── project-context-and-next-steps.md     # Start here: current state, gaps, next-phase plan
│   ├── localgo-delivery-architecture-plan.md  # Authoritative phased plan (see section 16)
│   └── cart-integration-runbook.md           # Activation, migrations and recovery
├── pyproject.toml               # Project metadata, dependencies, scripts, and pytest config
├── uv.lock                      # Dependency lockfile
├── .env.example                 # Environment variable template
└── AGENTS.md                    # Agent coordination log and strict operating rules (this file)
```

---

## Session Handoff — 2026-11-05

### User goal and unresolved client choice

The requested customer journey is:

**Sign in to a LocalGo account → open Goer → discover food and edit a database-backed cart → save conversation history → explicitly confirm checkout → persist the paid order.**

This journey is **not fully activated yet**. Adding food creates cart records;
only confirmed successful payment should produce the final order. Do not confuse
completed implementation milestones with a working, live customer deployment.

The user has now selected the **existing LocalGo mobile app** and confirmed
that the already-connected Supabase project is **development-only**. Continue
that integration; do not add browser checkout or activate production resources.
The local runtime now works (Node 26.13.0). The development backend's service-role
key is empty and no database-admin connection is configured, so live migration
and cart verification remain blocked until private credentials are supplied.

### What exists versus what is usable

| Area | Current state |
|---|---|
| Browser/CLI | Guest discovery, product cards and bounded follow-up context. The browser has **no sign-in, real cart editing or checkout UI**. |
| Authenticated mobile integration | Implemented behind feature flags: verified customer sessions, grounded cards, shared cart for chat/buttons, persisted retry IDs and account-switch fences. Not live-enabled or native-tested. |
| Cart planning | Discovery/Cart routing exists. CartCrew reads and proposes a typed plan; Python persists the exact command before executing it. No agent can charge or place orders. |
| Conversation storage | Snapshots and durable turn journal use **local SQLite**, not Supabase. `GOER_CONVERSATION_DB` overrides the default `~/.localgo/goer/conversations.sqlite3`. Shared-account history, retention/deletion and multi-host persistence remain unfinished. |
| Cart/checkout storage | Supabase repositories and migrations are written, but the migrations have **not been applied or tested against a live database**. |
| Checkout | Revision-locked quotes, explicit payment confirmation, payment fingerprint validation and retry/cancel recovery exist in code. Real Stripe sandbox checkout remains unverified. |

Repositories remain separate: this repository owns Goer reasoning/conversations;
`../LocalGo-Consumer-RN` owns customer authentication, canonical pricing, carts,
payments and orders. Do not introduce a second local cart as a fallback.

### Activation gates and previous verification

Templates intentionally leave `GOER_CART_ENABLED=false` (Goer),
`SERVER_CART_ENABLED=false` (LocalGo backend),
`EXPO_PUBLIC_SERVER_CART_ENABLED=false` and `EXPO_PUBLIC_GOER_API_URL` empty
(mobile). These are template defaults, not evidence of any deployed configuration.
LocalGo connectivity uses `LOCALGO_API_URL`; credentials must remain private.

The sibling repository contains two unapplied migrations, in this order:

1. `supabase/migrations/202611040001_customer_carts.sql`
2. `supabase/migrations/202611040002_cart_checkout.sql`

Only outer SQL syntax was parsed. PostgreSQL function execution, RLS, locking
and concurrency still need staging verification. No real Auth, live model,
Stripe, native build or deployment checks were performed.

**Last completed offline results:** 127 Goer tests, 116 pinned LocalGo backend
tests, all 8 tool smoke scripts, 4 browser Node cases, 3 mobile Node state cases,
and mobile TypeScript passed. These are previous results, not a new run for this
documentation update. The guest server was restarted and `/health` and
`/chat.js` checked earlier; verify it is still running next session rather than
assuming it is available at `http://127.0.0.1:8000`.

### Next session: smallest complete path

1. Confirm mobile versus browser, and staging versus production. Obtain approval
   before applying live migrations or enabling customer/payment flags.
2. Agree where account-linked conversation history must live. Current local
   SQLite is not shared Supabase history; implement the chosen persistence/UI
   gap rather than claiming it is already solved.
3. Review and verify both migrations in staging, configure the separate services
   and selected client, and deliberately enable the relevant staging flags.
4. Verify with a real test account: ownership isolation; saved history after
   restart; identical chat/button cart; interrupted requests replaying without
   duplicate edits; explicit Stripe sandbox checkout; one paid order persisted
   and the confirmed cart consumed once; safe cancellation/pending recovery.
5. Record actual results and remaining gaps before considering production.

Read `docs/project-context-and-next-steps.md`,
`docs/cart-integration-runbook.md`, and section 16 of
`docs/localgo-delivery-architecture-plan.md` before implementation. Preserve
stable request/order IDs, immutable commands, ownership fences, explicit payment
confirmation and one tool per file. Do not touch unrelated `resume.tex`.

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
| Agent | 2026-11-05 | AGENTS.md; README.md; docs/cart-integration-runbook.md; docs/project-context-and-next-steps.md; docs/localgo-delivery-architecture-plan.md | Finish mobile account-linked history and development activation verification | Active; code and offline verification complete; refreshing handoff; live migrations blocked by missing private credentials |

---

## 5. Recent Work

- 2026-11-05: Saved the end-of-session handoff above: clarified the intended
  signed-in account/cart/history/checkout journey, the unanswered mobile versus
  browser choice, local SQLite versus unapplied Supabase persistence, previous
  offline verification and the staging-first activation checklist. Documentation
  only; no code, credentials, flags or migrations changed and no suites rerun.
  **Commit pending:** shell execution is blocked by context-mode requiring Node
  24.15.0 while the host runs 22.23.2; the alternate isolated task runner also
  failed to initialize. Preserve this AGENTS.md update and commit it once local
  tooling is restored; do not upgrade tooling or activate services implicitly.
- 2026-11-05: Implemented all five authenticated cart integration milestones
  across this repository and `../LocalGo-Consumer-RN`: verified sessions/owned
  conversations; durable command staging, fenced leases and retry reconciliation;
  typed discovery/cart routing and grounded cart cards; shared mobile server
  cart with persisted pending requests/account fences; and explicit immutable
  revision-bound checkout with payment fingerprint verification, safe cancel,
  idempotent publication/consumption, and stable mobile checkout IDs. Signed-in
  discovery/planning now uses LocalGo's canonical 145-product snapshot; the
  138-product JSON fixture remains for guest/demo. One tool per file retained;
  CartCrew now has read tools only, and Python executes journaled writes.
  Completed checks: 127 Goer tests, 116 pinned backend tests, all 8 tool smoke
  scripts, 3 mobile and 4 browser Node cases, mobile TypeScript. No live model,
  Auth, DB migration, native build, or Stripe calls. Two SQL migrations await
  staging/RLS/concurrency verification; all activation flags remain false in
  templates. Updated plan, handoff, README and activation/recovery runbook.
- 2026-11-04: Completed the cart integration planning checkpoint (authoritative
  plan section 16). Application work is paused: next slice is verified Goer
  identity, followed by durable command staging/retry recovery, routing/cards,
  mobile cart synchronization, and checkout revision binding. No code changes,
  migrations, or test suites were run in this documentation-only step.
- 2026-11-04: Added LocalGo backend customer authentication, pure cart service,
  revision/idempotency manager, Supabase repository/RPC migration, and REST API
  in `../LocalGo-Consumer-RN`; its pinned backend suite passed 109 tests.
  Here, added `integrations/localgo/cart_client.py`, strict cart schemas, five
  individually filed cart tools, five offline HTTP smoke scripts, and opt-in
  `CartCrew` with a shared atomic mutation budget. Latest Goer suite: 110 tests
  passed. Earlier cart smoke runs passed; the final rerun was interrupted.
  No live migration/model calls or mobile changes. Public chat still uses
  Discovery only; cart routing awaits authenticated ownership and durable
  retries. Existing LocalGo checkout and local mobile cart remain unchanged.
- 2026-11-04: Split catalog tools into `tools/catalog/search_menu.py`,
  `get_menu.py`, and `get_product.py`, with shared serialization separate and
  backward-compatible imports in `catalog_tools.py`. Discovery and smoke tests
  use individual modules. 79 pytest tests and 3 smoke tests pass. Read-only
  audit of `../LocalGo-Consumer-RN` found that cart state/execution lives in
  the mobile Zustand store, with backend action proposals rather than cart
  REST endpoints. Recorded the integration decision in the handoff; no sibling
  files changed and no shadow cart or cart mutations introduced. Cart-agent
  integration awaits agreement on client-action bridge versus server-side API.
- 2026-11-04: Restored `resume.tex` to the original supplied content,
  including the original two Goer project bullets and bullet formatting.
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
