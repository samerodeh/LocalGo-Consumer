# Goer: Project Context and Next Steps

> Snapshot as of **2026-11-03**, after Phase 0. Read this first to pick up
> work. The full target architecture lives in
> [localgo-delivery-architecture-plan.md](localgo-delivery-architecture-plan.md);
> the working rules live in [AGENTS.md](../AGENTS.md).

---

## 1. What Goer is

Goer is the conversational ordering assistant for **LocalGo**, a local
restaurant delivery app. Today it answers menu questions over a fixed catalog
of **138 products** from two restaurants: `al-taib` (65 products) and
`chateau-kabab` (73 products). The goal is full ordering by chat: discover
food, build a cart, check out, pay, and track orders.

**Stack:** Python 3.10–3.13 · `uv` · CrewAI **1.14.4** (Flow + crew) ·
FastAPI · plain HTML chat UI · model chosen by the `MODEL` env var (default
`openai/gpt-4.1-mini`).

---

## 2. Rules that always apply

These are summarized from [AGENTS.md](../AGENTS.md), which is authoritative.

1. **One small commit per change**, using conventional prefixes (`feat:`,
   `fix:`, `test:`, `docs:`, `refactor:`, `chore:`, `build:`).
2. **No AI attribution, ever.** No `Co-Authored-By` lines, no "Generated
   with" lines, and no assistant or model names in commits, PRs, code, or docs.
   Use the label `Agent` in the work log.
3. **Register work in the AGENTS.md Active Work table before editing**, and
   move it to Recent Work when done. Commit both updates.
4. **Tools are deterministic.** The LLM never invents or calculates prices,
   stock, or state. Money is integer cents, and display strings come from
   `format_cents`.
5. **Test everything offline.** After touching a tool, run its smoke test and
   the full suite. Never call a real model from `tests/`.

---

## 3. Current state (what is built)

### Request path

```text
Browser (web/index.html)
  → POST /api/chat or /v1/chat         (api/main.py)
  → run_turn(message, user_id)         (main.py)
  → new GoerFlow() each turn           (main.py: capture_turn → answer_turn)
  → DiscoveryCrew → discovery_agent    (crews/discovery_crew/)
  → tools: search_menu, get_menu, get_product (tools/catalog_tools.py)
  → domain/catalog.py → cached JsonCatalogRepository → data_menu.json
  → plain-text reply
```

### Key modules

| File | Role |
|---|---|
| `src/goer_localgo/main.py` | `GoerState`, `GoerFlow`, `run_turn`, CLI loop |
| `src/goer_localgo/api/main.py` | FastAPI: `/`, `/health`, `/v1/chat`, `/api/chat` |
| `src/goer_localgo/crews/discovery_crew/` | One agent and one task, configured in YAML; `max_iter=6` |
| `src/goer_localgo/tools/catalog_tools.py` | `SearchMenuTool`, `GetMenuTool`, `GetProductTool` |
| `src/goer_localgo/domain/catalog.py` | `CatalogRepository` protocol, `JsonCatalogRepository` (cached), `set_catalog_repository`, compact views |
| `src/goer_localgo/domain/money.py` | `format_cents`, `normalize_currency` |
| `tests/conftest.py` | Offline guard (non-loopback network blocked), CrewAI telemetry/tracing off, isolated storage |
| `tests/stub_llm.py` | Deterministic `StubLLM`, `tool_call()`, `prompt_text()` |

### Tool contracts

| Tool | Input | Output |
|---|---|---|
| `search_menu` | `product_name`, optional `merchant_id` | `{total, returned, results[≤10]}`; each result has `product_id, merchant_id, name, category, price_cents, currency, display_price, has_options, description` |
| `get_menu` | `merchant_id` | `{merchant_id, product_count, categories[{name, items[{product_id, name, display_price}]}]}` or `MERCHANT_NOT_FOUND` (with `known_merchant_ids`) |
| `get_product` | `product_id` | Summary fields plus `description, allows_notes, option_groups, image_url`, or `PRODUCT_NOT_FOUND` |

Errors are always shaped as `{"error": {"code", "message", ...}}`. Product IDs
are globally unique across both merchants.

### Tests

There are 39 pytest tests (unit and integration) plus 3 smoke tests, and all
pass with no API key.

---

## 4. Known gaps and gotchas

| # | Issue | Where | Fixed in |
|---|---|---|---|
| G1 | **No memory between turns.** A new `GoerFlow` is built every turn, so "the second one" or "add two of those" cannot work. | `main.py:run_turn` | Phase 1 |
| G2 | **The UI sends the full history, but the server uses only the last user message.** | `web/index.html` → `api/main.py:_latest_message` | Phase 1 |
| G3 | **Replies are plain text.** There are no cards or actions, and the client cannot render products. | `api/main.py:ChatResponse` | Phase 1 |
| G4 | **`user_id` comes from the request body**, so it is untrusted. | `api/main.py:ChatRequest` | Phase 2 (JWT) |
| G5 | **Search is substring-only on product names.** It does not match category or description, and has no fuzzy matching ("shwarma"). | `domain/catalog.py:search_products` | Phase 1 |
| G6 | **There are no restaurant records** (name, hours, delivery zone). Merchants exist only as IDs on products. | `data_menu.json` | Phase 1 (list) / Phase 2 (DB) |
| G7 | **No product has option groups yet**, so option handling is untested with real data. | `data_menu.json` | When real data arrives |
| G8 | **The `uv run pytest` launcher fails on this machine** with "uv trampoline failed". Use `uv run python -m pytest tests -v` instead. | local `.venv` | Try `uv sync` |
| G9 | **Eight older commits (`f99cba9`…`6795a2b`, unpushed) carry `Co-Authored-By` lines.** Rewriting them is pending the owner's decision. | git history | Owner decision |

---

## 5. Roadmap overview

| Phase | Scope | Status |
|---|---|---|
| 0 | Harden prototype: model from env, cached repository, compact tools, `get_product`, money helper, offline tests | ✅ Done |
| **1** | **Stateful conversations and structured response envelope (cards)** | **Next** |
| 2 | Postgres (Supabase), JWT auth, Postgres-backed Flow persistence | Planned |
| 3 | Cart: domain service, REST, cart agent, `cart_summary` card | Planned |
| 4 | Checkout: addresses, delivery zone, quotes, confirm via direct action, payment | Planned |
| 5 | Orders: state machine, dispatch, tracking, support agent, cancellation | Planned |
| 6 | Production: tracing, evals in CI, rate limits, streaming, rollout | Planned |

---

## 6. Phase 1 plan (next)

**Goal:** a conversation such as *"What's at Château Kabab?"* → *"Tell me about
the second one"* works, and the UI shows product cards built from tool
results.

**Exit criteria:**
- Multi-turn reference resolution works in a stub-LLM test.
- The response envelope validates against its schema.
- The UI renders `product_list` and `product_detail` cards.
- The `/api/chat` text reply stays backward compatible.
- All tests pass offline.

### Step 1: Response schemas (`schemas/chat.py`, new)
- Define Pydantic models: `ProductCard`, `ProductListCard`,
  `ProductDetailCard`, `Action`, and `ChatEnvelope(conversation_id, turn_id,
  text, cards, actions, trace_id)`.
- Use a discriminated union on `type`, with `extra="forbid"`.
- Add unit tests for schema validation.

### Step 2: Per-turn tool result collector
- Tools record their structured results (not only the JSON string) into a
  per-turn collector, for example a `contextvars.ContextVar` set by the Flow
  for each turn.
- Add a domain-level `build_cards(collected_results)` function:
  `search_menu` and `get_menu` results become a `product_list` card, and
  `get_product` becomes a `product_detail` card.
- Cards must come from tool data, never from model prose.
- Add unit tests: each tool's result produces the expected card, and error
  results produce no card.

### Step 3: Flow state and memory
- Expand `GoerState`:
  - `id` (equal to `conversation_id`)
  - `recent_turns` (capped at 6, each `{role, text}`)
  - `last_shown_product_ids` (ordered)
  - `response: ChatEnvelope | None`
- Add `@persist` using CrewAI's default SQLite store in development. Before
  writing code, verify the import path and how state is restored in
  **1.14.4** (`crewai.flow.persistence`); use the `build-flow` /
  `check-crewai-api` skills.
- Change `run_turn(message, conversation_id)` to restore state by ID instead
  of starting fresh.
- Pass `recent_turns` and a numbered list of `last_shown_product_ids` into the
  task as inputs, so "the second one" resolves to an ID.
- Update `tasks.yaml` to add `{conversation_context}` and the rule "resolve
  references using the numbered list."
- Add tests: two `run_turn` calls on the same ID, where the second prompt
  contains the first turn's products, and a different ID that shares nothing.

### Step 4: Restructure the Flow
- Split the Flow into `load_context` → `answer_turn` → `compose_response`.
- `compose_response` builds the `ChatEnvelope`, appends the turn, updates
  `last_shown_product_ids` from the cards, and enforces an output size cap.
- If the agent hits its limits or raises, return a graceful text reply with
  any partial cards.
- Move the Flow out of `main.py` into `flow/goer_flow.py` and
  `flow/state.py`. Keep `main.py` as thin CLI entry points.

### Step 5: API
- Add `POST /v1/conversations`, which returns a new `conversation_id`.
- Add `POST /v1/conversations/{id}/turns` with body `{message}`, returning a
  `ChatEnvelope`.
- Keep `/v1/chat` and `/api/chat` working. They map to a turn and return
  `{user_id, message}` as before, plus optional `conversation_id` and
  `cards`.
- Add integration tests for the new endpoints with the stub LLM, plus a
  test for the legacy endpoint shape.

### Step 6: Better discovery
- Add a `list_restaurants` tool: derive the merchant list from the catalog,
  with display names in a small config map until real restaurant records exist.
- Search should also match `category` and `description`, ranking name matches
  first.
- Add simple fuzzy matching (`difflib`, no new dependency), so "shwarma"
  finds "shawarma".
- Write a smoke test and unit tests for each change.

### Step 7: Web UI
- Store `conversation_id` (in `sessionStorage`) and call the new turn
  endpoint.
- Render `product_list` and `product_detail` cards using image, name, and
  `display_price`.
- Render only known card types and ignore anything else.

### Step 8: Wrap up
- Update AGENTS.md (cheat-sheet and Recent Work), mark Phase 1 done in the
  architecture plan, and refresh this document.
- Run one manual live check with a real key (`uv run goer`, two turns that
  reference each other).

---

## 7. Decisions still open

These are listed in section 15 of the architecture plan. Phase 1 needs none
of them; Phase 2 and later do.

1. Is there an existing LocalGo Supabase project and schema, or does Goer's
   Postgres become the source of truth?
2. Payment provider (Stripe assumed), and whether capture happens at merchant
   accept or at delivery.
3. Tax jurisdiction(s).
4. Delivery fee and zone model.
5. Dispatch: in-house drivers or a third party?
6. Guest discovery without login?
7. A separate smaller model for the router once evals exist?

---

## 8. Commands

```powershell
uv sync                                                    # install
uv run goer                                                # terminal chat (needs OPENAI_API_KEY in .env)
uv run uvicorn goer_localgo.api.main:app --reload          # web UI at http://127.0.0.1:8000
uv run python -m pytest tests -v                           # full offline suite
uv run python src/goer_localgo/tools/try-out-tools/search_menu_smoke.py
uv run python src/goer_localgo/tools/try-out-tools/get_menu_smoke.py
uv run python src/goer_localgo/tools/try-out-tools/get_product_smoke.py
```
