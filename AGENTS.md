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
- **Conversation Foundation**: Application-owned SQLite snapshots and a fenced durable turn journal. Mobile Supabase display transcripts/history selection are separate; they do not replace reasoning or command persistence. Signed-in identity comes from LocalGo's verified session, never body IDs. Stable request UUIDs and completed-response caches preserve safe retries; tokens stay out of state/prompts. Guest/demo and authenticated conversations are separate. Live activation and multi-host persistence remain gated.
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

## Current handoff — 2026-11-06 (evening) — read this first

This section supersedes the older handoffs below where they conflict.

**Branches and commits.** Work happens on `dev` in both repositories; pushes go to
`origin dev` only. Local `main` in this repository holds old pre-cleanup commit IDs
and must never be pushed. Commits are authored by the owner only (Rule 1a).
CI runs on pushes to `dev`/`main` and on PRs: `.github/workflows/tests.yml` here
(SQLite and Postgres matrix plus tool smoke scripts) and `app-tests.yml` in the
sibling repository (TypeScript, client and PGlite SQL tests). Both passed.

**Verified on localhost (Expo web build at :8082, Stripe test mode).** Sign-up
returns to Sign In; discovery cards; chat and button edits to the shared server cart;
history; account isolation; typed chat checkout (`deliver to` / `use address N` /
`tip` / `checkout` phrases / exact `CONFIRM ORDER <code>`); Stripe Payment Element
in the browser (`src/lib/payments.web.ts`); declined, cancelled, 3-D Secure and
stale-code cases. A read-only check confirmed one succeeded test PaymentIntent,
one `orders` row and one consumed checkout. Evidence is in
`docs/development-activation-checklist.md`.

**Added this session.**
- Langfuse tracing (`observability.py`): one trace per turn, sessions by
  conversation ID, hashed user IDs, masking of tokens, keys, emails and card numbers.
  Disabled without keys or when `OTEL_SDK_DISABLED=true`.
- Latency: shared model clients (`llm.py`), startup warm-up, brief replies matching
  the cards. About 2.4 s warm and 4.2 s for the first turn after a restart.
- Discovery: merchant display-name matching, card selection that prefers focused
  results, category-aware `search_menu`, stable flow trace name.
- Safety: card numbers are refused before storage, tracing or the model, both in the
  Goer API (`api/guards.py`) and in the app's send path. In-process turn rate
  limits are 20/min and 200/hour per user or IP (multi-host needs a shared store).
- Storage (`domain/storage.py`): `GOER_DATABASE_URL` selects Postgres (private `goer`
  schema, RLS on, row locks); SQLite stays the default and existing files are
  upgraded in place. Retention via `GOER_RETENTION_DAYS` (default 90) and
  `DELETE /v1/me/data`, which the app's account deletion calls first.
- Latest checks: 177 Goer tests (Postgres included), 8 smoke scripts, 41 mobile/SQL
  cases with zero skips, and TypeScript all pass, locally and in CI.

**Local development notes.** Services: LocalGo backend 8100, Goer 8000, Expo web
8082 and Metro 8081. The mobile `EXPO_PUBLIC_*` values were passed as process
overrides. The owner put them in `backend/.env`; they belong in `.env.local`. The
real SQLite journal was backed up to
`~/.localgo/goer/conversations.sqlite3.backup-2026-11-06` before the schema upgrade.
Never read or print private `.env` values.

**Next, in order.**
1. Owner runs the read-only `supabase/checks/verify_cart_security.sql` (sibling
   repository) in the development SQL Editor; review RLS, policies, grants and RPC
   privileges against the migrations.
2. Native build: EAS development build on an Android device (owner needs an Expo
   account), then PaymentSheet checkout, restart, account-switch and A→B→A recovery.
3. Plain-sentence address input ("my address is …", "postal code is …") mapped
   onto the existing verified `deliver to` search.
4. Production setup, which needs owner decisions: host Goer (the LocalGo backend
   already uses Render), a separate production Supabase project, live Stripe keys
   plus webhook, `GOER_DATABASE_URL`, and a shared rate-limit store. Then a $1–2 live
   payment and refund, and app store builds and listings.

## Latest development verification — 2026-11-06

This update supersedes the older empty-service-key/missing-schema statements below.
Read-only connected checks validate the backend service key (Auth admin 200), all
five expected tables via service-role `limit=0` reads, expected columns and four
RPC names. Public-key table reads are denied (401 / `42501`). Sibling records
report user-run migrations; do not blindly reapply them. Exact SQL policies/grants,
authenticated isolation, concurrency and native checkout are still unverified.

The user authorized development-only setup and acceptance testing. Private `.env`
access was then blocked by the safety guard, so no flags, credentials, migrations,
test accounts or payments changed. Configure non-secret service URLs/flags privately
using the runbook once permitted, restart services, then exercise designated test
sessions. No database-admin connection/test sessions or native SDK/device were
available. Existing services respond on 8000/8100/8081; cart remains disabled.
Latest offline rerun: 127 Goer tests, 122 pinned backend tests, 36 mobile/SQL cases
(zero skips), mobile TypeScript passed. No native export or payment test was run.

## Session Handoff — 2026-11-05

### User goal and selected development client

The requested customer journey is:

**Sign in to a LocalGo account → open Goer → discover food and edit a database-backed cart → save conversation history → explicitly confirm checkout → persist the paid order.**

This journey is **not fully activated yet**. Adding food creates cart records;
only confirmed successful payment should produce the final order. Do not confuse
completed implementation milestones with a working, live customer deployment.

The user has now selected the **existing LocalGo mobile app** and confirmed
that the already-connected Supabase project is **development-only**. Continue
that integration; do not add browser checkout or activate production resources.
The latest request is to order and explicitly confirm checkout through typed
chat without a separate Cart screen. That path is implemented behind the flags;
secure Stripe card entry/bank authentication still requires its native prompt.
Strictly typing-only first-time card charging is not implemented or promised.
The local runtime now works (Node 26.13.0). The development backend's service-role
key is empty and no database-admin connection is configured, so live migration
and cart verification remain blocked until private credentials are supplied.

### What exists versus what is usable

| Area | Current state |
|---|---|
| Browser/CLI | Guest discovery, product cards and bounded follow-up context. The browser has **no sign-in, real cart editing or checkout UI**. |
| Authenticated mobile integration | Flagged verified sessions, grounded cards, shared cart, cloud history/picker, New conversation and Retry pending turn. Session writes are serialized/generation-fenced; reset locks against sends/restores. Not live-enabled or native-runtime-tested. |
| Cart planning | Discovery/Cart routing exists. CartCrew reads and proposes a typed plan; Python persists the exact command before executing it. No agent can charge or place orders. |
| Conversation storage | Reasoning snapshots/turn journal use **local SQLite** (`GOER_CONVERSATION_DB`, default `~/.localgo/goer/conversations.sqlite3`). Mobile account-linked **display transcripts** use Supabase; historical cart cards never mutate state. Completed-response retries publish history without resending cart work. Cloud history does not reconstruct missing SQLite state; retention/deletion and multi-host persistence remain unfinished. |
| Cart/checkout storage | All three migrations/RPC/RLS assertions execute in isolated PGlite PostgreSQL. They are **not applied to connected Supabase**; real concurrent-session behavior remains unverified. |
| Checkout | Typed address/tip/checkout and exact summary-code confirmation reuse the existing native payment pipeline. Original owner/request-bound receipts survive account switches/restarts; consumed pins cannot create replacement payments. Stripe secure UI may still be required. Real sandbox checkout remains unverified. |

Repositories remain separate: this repository owns Goer reasoning/conversations;
`../LocalGo-Consumer-RN` owns customer authentication, canonical pricing, carts,
payments and orders. Do not introduce a second local cart as a fallback.

### Activation gates and previous verification

Templates intentionally leave `GOER_CART_ENABLED=false` (Goer),
`SERVER_CART_ENABLED=false` (LocalGo backend),
`EXPO_PUBLIC_SERVER_CART_ENABLED=false` and `EXPO_PUBLIC_GOER_API_URL` empty
(mobile). These are template defaults, not evidence of any deployed configuration.
LocalGo connectivity uses `LOCALGO_API_URL`; credentials must remain private.

The sibling repository contains three connected-project-unapplied migrations:

1. `supabase/migrations/202611040001_customer_carts.sql`
2. `supabase/migrations/202611040002_cart_checkout.sql`
3. `supabase/migrations/202611050001_goer_history.sql`

Isolated PostgreSQL tests execute actual functions and verify owner RLS, RPC
grants, immutable history/cart replay, revisions, checkout locks, frozen quotes
and one-time consumption. Connected Supabase/concurrency still need verification.
Read-only checks confirmed Auth availability and Stripe `livemode=false`.
Two real-model guest browser turns now pass (pizza cards/prices and ordinal
follow-up in the same conversation). No signup, PaymentIntent/charge or native
app runtime was exercised.

**Latest results (2026-11-05):** 127 Goer tests (including 4 browser Node cases),
116 pinned backend tests, 36 mobile/SQL Node cases (zero skips), mobile TypeScript
and Android JS/assets export passed. Exporting JS is **not a native build or
PaymentSheet test**. The 8 tool smoke scripts passed previously; tools did not
change this session. Verify localhost services next session instead of assuming
the servers remain running. Latest startup checks: Goer `127.0.0.1:8000`,
LocalGo backend port 8100 and Expo/Metro 8081 pass; the canonical catalog has
145 products, unsigned session is 401 and cart stays feature-gated (503).
Metro Android manifest/bundle both return 200. Mobile launch uses a temporary
`EXPO_PUBLIC_API_URL` override to the current Wi-Fi address on port 8100; no
`.env` files changed. This is not proof of native sign-in/payment functionality.

### Next session: smallest complete path

1. Continue the chosen **mobile/development-only** path. Backend service-role key
   and database-admin access are missing. Supply credentials privately in sibling
   backend `.env`, never chat/mobile; use the existing project's SQL Editor/admin
   connection for DDL (a service-role HTTP key cannot apply migrations).
2. Review/apply the three migrations in order to that development project;
   verify real RLS/RPC concurrency. Keep Goer's existing durable SQLite database.
3. Configure the separate services (LocalGo 8100, Goer 8000) and reachable mobile
   URLs, then deliberately enable development flags for native testing.
4. Verify a real test account: owned history after restart/reinstall, history
   selection/New conversation, interrupted history publication retry without
   another cart write, chat/button parity, account switches, explicit Stripe
   sandbox checkout, one paid order/one cart consumption and cancel recovery.
5. Record real results and remaining gaps. Production activation is not authorized.
   UI retains its latest 50 messages; older in-thread paging remains absent.

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
| *(No active work locks)* | - | - | - | Browser sandbox checkout verified (one paid order); remaining: decline/cancel/3DS/stale-code browser checks, native build, production gates |

---

## 5. Recent Work

- 2026-11-06: Browser (Expo web) sandbox checkout now uses Stripe Payment Element
  (sibling `payments.web.ts`); owner completed one payment, verified read-only as one
  succeeded test-mode PaymentIntent ($13.26 CAD), one order with the same ID and one
  consumed cart revision. Chat checkout phrases in sentences open the summary; Goer's
  unsupported reply lists the chat commands. Added category-aware `search_menu`, card
  data refusal before model/storage/tracing (Goer API and mobile send) and in-process
  turn rate limits (20/min, 200/hour; multi-host needs a shared store). Replies average
  ~2.4 s warm after reusing model clients and startup warm-up. 164 Goer tests, smoke
  tests, 41 mobile/SQL cases and TypeScript pass. Decline/cancel/3DS/stale-code browser
  checks, native build and production gates remain.

- 2026-11-06: Localhost signed-in acceptance with flags enabled (backend 401 when
  unsigned, was 503). Two temporary development accounts were created, tested and
  deleted (Auth admin 200). Passed: canonical pricing, idempotent replay, same-key/
  different-command 409, stale revision 409, 6 concurrent same-revision writes with
  exactly one winner, per-user idempotency keys, cross-account cart/history isolation
  through direct Supabase reads/RPC/writes (403/404/no rows), owned Goer conversations
  (other account 404), retry with the same request_id returns the same envelope
  without a second cart write. Fixed merchant display-name matching (`Al-Taib` returned
  no pizza) in `domain/catalog.py` with regression tests; 133 tests and catalog smoke
  tests pass. Not exercised: mobile-published Supabase history, Goer restart
  persistence, checkout/PaymentIntent (no unconfirmed payments) and native app.
  Mobile URLs/flag are a Metro process override; `.env.local` is still stale.
- 2026-11-06: Owner tested the signed-in journey in the Expo web build
  (`localhost:8082`; sibling `src/lib/payments.web.ts` refuses payment on web and
  never creates PaymentIntents) and reported sign-in, discovery, cart, history and
  isolation working. Fixed: (1) sibling sign-up now discards the session Supabase
  issues when email confirmation is off and returns to Sign In with a notice;
  (2) discovery cards prefer the latest non-empty search/detail over a later
  full-menu dump and narrow menu-only cards to the request (real model: a pizza
  request previously showed bowls). 137 Goer tests, smoke tests, 36 mobile/SQL cases
  (zero skips with `LOCALGO_PGLITE_MODULE`) and TypeScript pass. Uncommitted.

- 2026-11-06: Persisted the user-authorized completion plan in
  `docs/development-activation-checklist.md`, including explicit connected/native
  acceptance, payment confirmation boundaries and cleanup. Continue executable
  items without repeated permission, but do not bypass safety blocks. Fresh probes:
  Goer/backend/Metro and 145-product catalog return 200; unsigned session 401;
  cart still 503. ADB absent from PATH/common configured SDK locations. No private
  files, flags, accounts or payments changed; configuration/test-session/device
  dependencies keep acceptance open. Documentation-only; suites were not rerun.

- 2026-11-06: Verified connected development service-key access, five expected
  tables/columns and four RPC names without mutations; anonymous reads denied.
  Exact policies/grants/owner isolation/concurrency remain unverified. Reran 127
  Goer tests, 122 pinned backend tests, 36 mobile/SQL cases (zero skips) and mobile
  TypeScript successfully. Activation stopped at the private `.env` safety block;
  no flags, secrets, schema, test accounts or payments changed. Native SDK/device
  and designated test sessions/admin SQL access remain unavailable. Updated runbook
  and handoff; next configure development URLs/flags privately, restart and perform
  authenticated/native acceptance. No production activation authorized.

- 2026-11-05: Added typed mobile checkout controls without Cart-screen navigation:
  verified address search/selection, tips, complete CAD summary, exact
  `CONFIRM ORDER <code>` and cancellation. Models cannot authorize payments.
  Original owner/request-scoped receipts persist before payment; account-switch,
  overlapping-waiter and storage-interruption recovery retains the real order
  reference and refuses replacement payments. Serialized address hydration and
  edits prevent lost addresses. Recovery review findings reproduced/fixed;
  all 36 mobile/SQL cases, TypeScript, Android JS/assets export, 127 Goer tests
  and 116 pinned backend tests pass. External Auth/model/payment are doubled in
  typed-flow tests; no native payment or signed-in connected acceptance occurred.
  Read-only dev Supabase checks return `404 PGRST205` for cart/checkout/history
  tables; service-role key remains empty and admin access/test account/device
  are needed. Flags/secrets/live schema were not changed. Local probes: Goer
  8000, backend 8100 (Stripe test), refreshed Metro 8081 return 200. Metro now
  uses Wi-Fi `192.168.2.26` for the backend process override; recheck on restart.
  Follow `docs/cart-integration-runbook.md` section 6. Do not claim typing-only
  first-time card payment: Stripe's secure prompt/bank challenge is still required.

- 2026-11-05: Started Goer (8000), pinned LocalGo backend (8100) and Expo
  dev-client/Metro (8081). Real headless Edge/live-model smoke passed: Al-Taib
  pizza discovery renders five grounded cards/prices; ordinal follow-up renders
  the first product's details in the same conversation. Browser screenshot is
  `%TEMP%/goer-live-browser.png`. Reran all offline checks: 127 Goer tests,
  116 pinned backend tests, 22 mobile/SQL cases (zero skips), TypeScript passed.
  Live Expo Android manifest/bundle return 200 (12,037,042-byte bundle); this
  does not run native SDKs. Canonical catalog returns 145 products; unsigned
  session is 401, disabled cart is 503. Backend requires its `uv run` environment;
  directly invoking the cached interpreter failed with `No pyvenv.cfg file`.
  Persistent Windows launch used hidden-console PowerShell `Start-Process`;
  detached-console PowerShell exited without launching. Logs are under `%TEMP%`
  (`goer-app.*.log`, `localgo-backend-3.*.log`, `localgo-mobile.*.log` and
  `*-run-app-*.log`). No Android SDK/emulator/device is available. Backend
  service-role/admin access and connected migrations are still missing; no
  real account history/checkout, payment, migration, secret or flag changes.
  Mobile API URL override exists only in the running process. Verify services
  again next session rather than assuming detached processes survived.
- 2026-11-05: Finished mobile account-linked Supabase display history in the
  sibling repository: immutable owned publication, history picker, New conversation,
  explicit pending retry, cached completed envelopes and display-only historical
  cart cards. Fixed A-B-A async leakage, serialized native session writes and
  reset/send races with deferred-operation regression tests. Added third migration
  `202611050001_goer_history.sql`. Latest checks: 127 Goer tests, 116 pinned backend
  tests, 22 mobile/SQL Node cases with zero skips, mobile TypeScript and Android
  JS/assets export. All three migrations/RPC/RLS assertions execute in isolated
  PGlite PostgreSQL; connected Supabase/concurrency/native checkout remain gated.
  Read-only Auth availability and Stripe test-mode checks passed; no signup/model/
  payment, live migration, secret or activation-flag changes. User chose existing
  mobile app and development-only Supabase. Missing backend service-role/admin
  access is the next blocker; no production activation is authorized. Updated
  runbook, authoritative plan, README and handoffs; released coordination locks.
- 2026-11-05: Saved the end-of-session handoff above: clarified the intended
  signed-in account/cart/history/checkout journey, the unanswered mobile versus
  browser choice, local SQLite versus unapplied Supabase persistence, previous
  offline verification and the staging-first activation checklist. Documentation
  only; no code, credentials, flags or migrations changed and no suites rerun.
  Tooling initially blocked the commit (Node 22.23.2 below context-mode's
  24.15.0 minimum; isolated runner also failed). **Resolved:** tooling restored
  with user authorization, Node now 26.13.0, handoff committed as `2992d87`.
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
