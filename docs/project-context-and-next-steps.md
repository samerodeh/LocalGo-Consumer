# Goer: Project Context and Next Steps

> Updated **2026-11-04**, after the Phase 1 conversation foundation.
> Working rules: [AGENTS.md](../AGENTS.md).
> Authoritative target: [localgo-delivery-architecture-plan.md](localgo-delivery-architecture-plan.md).

## 1. Product and stack

Goer is LocalGo's conversational food-discovery assistant, targeting full
ordering later. Today it browses **138 products** from `al-taib` and
`chateau-kabab`. There is **one Discovery Agent**, not four implemented agents.

Python 3.10–3.13, `uv`, CrewAI **1.14.4**, FastAPI, plain browser JavaScript,
JSON catalog, and development SQLite conversation storage. Model configuration
uses `MODEL` (default `openai/gpt-4.1-mini`) and `OPENAI_API_KEY`.

## 2. Required operating rules

- Register work in `AGENTS.md` before edits; check overlapping locks.
- Commit each focused change immediately, using conventional commit messages.
- No attribution trailers or generated-by statements anywhere in the repository.
- Domain logic and tools are deterministic; money is integer cents CAD.
- Run the full offline pytest suite and each changed tool's smoke test.
- Tests use `tests/stub_llm.py`; never call a real provider from `tests/`.

## 3. Implemented request path

```text
Browser / CLI
  → create conversation; reuse its ID for subsequent messages
  → run_conversation_turn(message, conversation_id, user_id)
  → load owner-scoped conversation snapshot from SQLite
  → new GoerFlow for this execution (NOT a new conversation)
      load_context → answer_turn → compose_response
  → DiscoveryCrew with compact recent history + numbered displayed products
  → search_menu / get_menu / get_product → cached JSON repository
  → request-local collector → grounded cards + validated ChatEnvelope
  → compare-and-swap snapshot save; conflicting writes fail with HTTP 409
```

### Main files

| File | Responsibility |
|---|---|
| `flow/goer_flow.py` | Flow steps, conversation creation/turn entry points, compatible text wrapper |
| `flow/state.py` | Flow state and recent-message models |
| `domain/conversations.py` | Repository protocol, development SQLite implementation, ownership/revisions |
| `domain/cards.py` | ContextVar-scoped tool collector and deterministic card assembly |
| `schemas/chat.py` | Strict response/card/action models and discriminated card union |
| `api/main.py` | New conversation routes, legacy chat, static web files |
| `main.py` | Thin CLI; one conversation per interactive session |
| `web/index.html`, `web/chat.js` | Session-aware browser, card rendering, New chat button |
| `domain/catalog.py`, `domain/money.py` | Cached catalog views, cents formatting |
| `tests/conftest.py`, `tests/stub_llm.py` | Network guard, test-only storage, shared stub-model fixture |

Paths in this table are under `src/goer_localgo/` unless starting with `tests/`.

### Response and memory rules

- Envelope: `conversation_id`, `turn_id`, `text`, `cards`, `actions`, `trace_id`.
- `trace_id` is currently a response identifier, not an instrumented distributed
  trace. Propagation/instrumentation remains future work.
- Cards come from the latest successful catalog lookup, never from model prose.
- At most one card and five products per response; text capped at 8,000 characters.
- Product detail includes descriptions, notes support, and upstream option data.
- Saved snapshot contains six recent exchanges (12 messages) and up to five
  ordered displayed product IDs, not full tool transcripts.
- Clarification-only replies preserve product references; empty result lists
  clear them. Tool errors do not create cards.
- Agent exceptions yield a safe reply with any collected partial cards.
- Concurrent turns may both run discovery, but only one snapshot revision can
  commit. The other returns 409. This is appropriate for read-only discovery;
  transactional tools will also need domain-level idempotency.

### Persistence decision

Application `conversation_id` is separate from CrewAI execution `state.id`.
Pinned CrewAI 1.14.4 lacks the newer `restore_from_state_id` kickoff parameter;
we deliberately use application-owned snapshots, not `@persist`, for sessions.
The domain repository does not import CrewAI and can be replaced by PostgreSQL.

Default database: `~/.localgo/goer/conversations.sqlite3`.
Override with `GOER_CONVERSATION_DB` (prefer an absolute path). Connections close
after each operation. Tests use a temporary database per test.

### API

| Endpoint | Behavior |
|---|---|
| `POST /v1/conversations` | 201 with `{conversation_id}` |
| `POST /v1/conversations/{id}/turns` | Body `{message}`; returns `ChatEnvelope` |
| `POST /v1/chat`, `/api/chat` | Preserve `{user_id, message}` response fields; add conversation ID, cards, actions; optional request `conversation_id` continues a session |
| `GET /`, `/chat.js`, `/health` | Browser assets and health |

Turns validate nonblank messages up to 4,000 characters. Unknown/wrong-owner
conversations return 404; revision conflicts return 409. Legacy `messages`
requests still use only the latest user message; server snapshots hold history.
The browser sends the new single-message turn request and stores its ID in
`sessionStorage`. It does not restore the visible transcript after page reload.

## 4. Security and known limitations

**Local-development only until authentication is implemented.** New routes use
one shared demo principal; legacy `user_id` is still client-supplied and not a
trusted identity. Repository ownership checks are not a substitute for JWTs.
Do not expose this application with real user data as-is.

Other remaining gaps:
- No router, cart, checkout, payment, order, or support implementation yet.
- No hard wall-clock turn timeout or global tool-call budget yet; the existing
  Discovery Agent remains bounded by `max_iter=6`.
- Model prose is prompted to match card ordering but not mechanically verified;
  cards themselves are deterministic. Stub tests verify wiring, not model quality.
- Search remains product-name substring matching. Restaurant/category tools,
  broader/fuzzy search, real merchant hours, zones, and availability remain pending.
- Current catalog has no real option groups. They pass through from upstream
  data; typed option contracts and option-picker UI are still future work.
- Browser supports product list/detail cards, not action execution or checkout.
- Real-model and visual-browser checks were not run in this increment.
- The local `uv run <launcher>` trampoline may fail. Use `uv run python -m ...`.
- Historical unpushed commits noted in the prior handoff contain attribution
  trailers; rewriting history still requires the owner's decision.

## 5. Verification

**76 pytest tests pass**, plus **3 tool smoke tests**, with no live model calls.
The suite covers typed cards, tool collection/isolation, durable snapshots,
owner checks, concurrent conflicts, bounded history, reference context, failure
fallback, API compatibility, and CLI session reuse.

`tests/web/chat.test.cjs` runs three browser-script tests through Node, invoked
by pytest when Node is installed. These use a small DOM harness, not a real
browser, and are skipped if Node is absent. A Starlette/httpx deprecation warning
remains unrelated to this work.

## 6. Next steps

1. Finish Phase 1 discovery improvements: `list_restaurants`,
   `get_menu_categories`, category/description ranking and fuzzy matching;
   add deterministic tests and a smoke test for each tool.
2. Manually test browser layout and a real two-turn reference-resolution
   conversation when a provider key is available and live execution is desired.
3. Add structured intent routing with only discovery enabled initially;
   unsupported transactional intents must not pretend to act.
4. Establish JWT identity and PostgreSQL or existing LocalGo backend adapters
   before enabling transactional tools.
5. Implement cart domain service, REST actions, and then the Cart Agent.
6. Follow the authoritative plan for checkout, payments, orders, and support.

Open business decisions: existing LocalGo system of record, payment provider
and capture timing, tax jurisdiction, delivery fees/zones, dispatch integration,
and whether guest discovery is allowed. No infrastructure was provisioned.

## 7. Commands

```powershell
uv sync
uv run python -m uvicorn goer_localgo.api.main:app --reload
uv run python src/goer_localgo/main.py --interactive
uv run python -m pytest tests -v
uv run python src/goer_localgo/tools/try-out-tools/get_menu_smoke.py
uv run python src/goer_localgo/tools/try-out-tools/search_menu_smoke.py
uv run python src/goer_localgo/tools/try-out-tools/get_product_smoke.py
```

Optional local storage override:

```powershell
$env:GOER_CONVERSATION_DB = "C:\localgo-data\conversations.sqlite3"
```
