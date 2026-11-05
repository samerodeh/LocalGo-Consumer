# Goer: Project Context and Next Steps

> Updated **2026-11-04**, after cart foundations and an integration planning checkpoint.
> Working rules: [AGENTS.md](../AGENTS.md).
> Authoritative target: [localgo-delivery-architecture-plan.md](localgo-delivery-architecture-plan.md).

## 1. Product and stack

Goer is LocalGo's conversational food-discovery assistant, targeting full
ordering later. Today it browses **138 products** from `al-taib` and
`chateau-kabab`. **Discovery is wired into chat; CartCrew is built but opt-in
only.** Authenticated cart routing and mobile synchronization are not enabled.

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
| `tools/catalog/{search_menu,get_menu,get_product}.py` | One catalog tool and its input schema per file; `catalog_tools.py` retains compatibility imports |
| `integrations/localgo/cart_client.py` | Token-forwarding HTTP cart adapter, safe errors, validated backend responses |
| `tools/cart/` | Five individually filed cart tools; private credentials/request keys, shared mutation budget |
| `schemas/cart.py`, `crews/cart_crew/` | Cart wire models and an offline-tested specialist, not yet dispatched by the Flow |
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
- No public cart routing, authenticated Goer conversations, cart cards, mobile
  synchronization, checkout, or order/support integration. Cart backend/tools
  and an opt-in specialist exist; do not connect them to the demo principal.
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

Last completed suites: **110 Goer pytest tests** and **109 LocalGo backend
 tests** passed with no live model calls. There are 3 catalog and 5 cart smoke
scripts. Earlier cart smoke runs passed; the final full smoke rerun was
interrupted after `get_cart`, so it is not a completed final smoke pass.
The suite covers typed cards, tool collection/isolation, durable snapshots,
owner checks, concurrent conflicts, bounded history, reference context, failure
fallback, API compatibility, and CLI session reuse.

`tests/web/chat.test.cjs` runs three browser-script tests through Node, invoked
by pytest when Node is installed. These use a small DOM harness, not a real
browser, and are skipped if Node is absent. A Starlette/httpx deprecation warning
remains unrelated to this work.

## 6. Next steps

### LocalGo integration audit (2026-11-04)

The owner approved adding a server-side cart API to `../LocalGo-Consumer-RN`.
That backend now has:
- `app/auth.py`: customer identity verified by Supabase Auth, not decoded claims.
- `app/cart/`: pure validation/pricing, request replay manager, Supabase adapter.
- `app/routers/cart.py`: authenticated `/v1/cart` read/add/update/remove/clear.
- Explicit restaurant IDs in all 145 server catalog entries; no client prices.
- `supabase/migrations/202611040001_customer_carts.sql`: cart/receipt tables,
  own-read RLS, backend-only atomic revision/idempotency commit RPC.

The SQL was syntax-parsed, not executed against a database. No migration or
live deployment was performed. LocalGo's backend README documents setup.

The mobile `src/store/cartStore.ts` and `src/goer/tools/executors.ts` still use
their original local cart; the older backend Goer pipeline still proposes
client actions. They were not changed. New server cart endpoints must not be
enabled for assistant use in the live app until the mobile paths share them.
Existing payment/order endpoints also remain unchanged and do not yet bind to
the new cart revision.

Goer's `CartCrew` is callable with an injected `LocalGoCartClient` and stable
request key. It has no checkout/order/payment tools, disables caching/retries,
and shares an atomic one-mutation budget. Its real tool loop was exercised with
a stub model and mocked HTTP. The public `GoerFlow` still calls Discovery only.
No JWT or customer token has been added to demo routes or persisted in state.

All new tools must use one implementation per file, grouped by capability,
with shared transport/serialization helpers separate from tool classes.

### Planning checkpoint and next implementation slice

Application implementation is paused at the owner's request; the current step
only updates the plan. No suites or migrations were run in this planning step.
The detailed checklist is section 16 of the authoritative architecture plan:

1. **Verified Goer identity** (next slice only): LocalGo `/v1/session`, Goer
   request-scoped session adapter, owned authenticated conversations. Never
   automatically adopt shared demo conversations or persist bearer tokens.
2. **Durable turn retry safety:** stable client request UUID, immutable message
   hash/command/revision/key persisted before writes, completion replay and
   reconciliation after ambiguous network failure. Adapt CartCrew to propose a
   typed plan; Flow invokes the existing write tools after durable staging.
3. **Routing and cards:** one specialist per turn, cart snapshots and grounded
   `cart_summary`; unsupported payment/order tools remain absent.
4. **Mobile synchronization:** signed-in Zustand state becomes a server cache;
   normal buttons and old Goer executors call the same API, with revision checks
   and stable keys. Preserve explicit demo mode and clear cache on account switch.
5. **Checkout consistency:** bind server-priced checkout/payment to the cart
   revision without changing explicit confirmation or payment/order protections.

Activation requires staging migration/RLS/concurrency checks, end-to-end retry
recovery, and chat/button/checkout parity. Live deployment is not part of this
planning step. Run required repository checks when implementation resumes.

Discovery improvements and live/visual quality checks remain on the roadmap,
as do checkout/support agents. Cart source-of-truth is decided: LocalGo, not
Goer's SQLite. Tax rules, capture timing, delivery business rules, and guest
policy remain open. No infrastructure was provisioned.

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
