# Goer: Project Context and Next Steps

> Updated **2026-11-04**, after the five authenticated cart integration milestones.
> Rules: [AGENTS.md](../AGENTS.md). Target: [architecture plan](localgo-delivery-architecture-plan.md).
> Setup/recovery: [cart integration runbook](cart-integration-runbook.md).

## 1. What is implemented

Goer remains a separate CrewAI 1.14.4 + FastAPI service. LocalGo's existing
backend/Supabase owns carts, pricing, payment, and order state; Goer does not
persist a shadow cart. There are **two specialist definitions**:

- **DiscoveryCrew** reads menus/products and produces text; Python builds cards.
- **CartCrew** reads catalog/cart data and produces a typed `CartPlan`. It has
  **no mutation tools**. Python stages the command durably, then invokes one of
  the individual write tools. Checkout/order/support model specialists are not
  implemented; checkout remains an explicit app confirmation/payment path.

A bounded structured classifier chooses discovery, cart, or unsupported intent.
No multi-agent swarm runs on each message. New integration is feature-gated and
has not been activated against a live database or payment provider.

## 2. Request paths

### Guest/demo

```text
Browser / CLI → existing conversation API → Discovery GoerFlow
  → JSON fixture repository (138 products) → tool-result cards → SQLite history
```

Body `user_id` is no longer an authority, even on legacy chat endpoints. Guest
conversations use a separate demo principal and are never auto-adopted by an
account. Browser/CLI retain the existing demo UX; browser code can render cart
cards but does not provide a native sign-in session itself.

### Signed-in mobile

```text
Supabase session → Goer verifies via LocalGo GET /v1/session
  → owner-scoped conversation + stable request UUID
  → durable turn journal / fenced lease
  → structured intent classification
      discovery → canonical LocalGo catalog (145 products) → DiscoveryCrew
      cart      → actual cart snapshot → read-only CartCrew → typed plan
      unsupported → deterministic explanation; no checkout/order tool
  → persist exact command + revision + backend key before mutation
  → individual cart write tool → authenticated LocalGo API → atomic RPC
  → persist backend result → deterministic cart reply + grounded cart_summary
  → atomically commit response + bounded conversation history
```

Completed retries replay the saved envelope. Uncertain writes retain their
exact plan for reconciliation; a new message is blocked until recovery. No model
is rerun to invent a replacement mutation. An expired planning lease can be
reclaimed, but its old worker is fenced from staging/executing a command.

## 3. Main modules (under `src/goer_localgo/`)

| File | Role |
|---|---|
| `config.py` | Load development `.env` without overriding deployment values |
| `api/auth.py` | Verified request-scoped customer session; token excluded from repr/state |
| `api/main.py` | Owned conversations, stable request IDs, 202 pending replies, explicit CORS origins |
| `domain/conversations.py` | Owner-scoped SQLite snapshots and revision checks |
| `domain/turns.py` | Durable immutable plans/results, request hashes, leases/fences, response replay |
| `flow/goer_flow.py`, `state.py` | Existing read-only Discovery Flow and bounded history |
| `flow/authenticated.py` | Signed-in orchestration; stages commands before Python writes |
| `flow/routing.py` | Typed classifier with a 20-second provider timeout |
| `crews/cart_crew/` | Read-only cart planning task with `CartPlan` output |
| `domain/catalog.py` | Repository interface + request-local repository scoping |
| `integrations/localgo/catalog_repository.py` | One canonical catalog snapshot per request; no stale fallback |
| `integrations/localgo/cart_client.py` | Customer-token forwarding, no redirects, safe HTTP errors |
| `tools/catalog/` | One catalog tool/schema per file; legacy import shim retained |
| `tools/cart/` | Five tools, each in its own file, with private client/request key |
| `schemas/cart.py`, `chat.py` | Typed plans/cart snapshots and product/cart card union |
| `domain/cards.py`, `money.py` | Deterministic cards and integer-cent formatting |
| `main.py`, `web/` | Guest CLI/browser clients, safe DOM rendering |

Conversation memory is six exchanges and up to five ordered product references.
Cards are built from tool/backend data, not prose. `trace_id` is still only a
response identifier; distributed instrumentation is future work.

## 4. LocalGo sibling changes

`../LocalGo-Consumer-RN` is a separate repository, committed separately.

### Backend

- `app/auth.py`, `/v1/session`: Supabase Auth verifies the caller; no decoded-claim
  identity is trusted for new cart operations.
- `/v1/catalog/products`: canonical IDs/prices/categories/descriptions for 145
  items, generated from the existing mobile menu source.
- `app/cart/`, `/v1/cart`: strict inputs, server pricing, single restaurant,
  revisions, atomic retry receipts, and checkout lock status.
- Two migrations: `202611040001_customer_carts.sql` and
  `202611040002_cart_checkout.sql`. RLS permits own-cart reads, not direct user
  writes; backend-only RPCs commit carts and acquire/consume/release checkout locks.
- Server mode requires an owned cart revision for payment intent creation.
  Frozen quote/order/owner/revision/fingerprint and exact paid amount are verified
  before publishing canonical server item names/quantities and consuming the cart.
- Cancellation verifies provider state and cancellation before unlocking. A paid
  server-cart intent cannot fall back to legacy caller-controlled order contents.

### Mobile

- `src/lib/serverCart.ts`, `src/store/cartStore.ts`: typed API + server cache,
  serialized writes, stable keys persisted before HTTP, explicit pending recovery.
- Ordinary buttons and old `src/goer/tools/executors.ts` cart operations call the
  same backend in server mode. Demo mode remains separate.
- `src/goer/authenticatedClient.ts`: real session forwarding, stable conversation/
  request IDs, server cards, no offline mutation replay, account-switch fences.
- Goer tab launcher is conditional on the server-cart flag and separate Goer URL.
- `src/lib/checkoutSession.ts`, payment/order helpers: stable checkout identity,
  revision-bound confirmation, provider cancellation/recovery, idempotent history.
- Cart notices expose Retry pending request and Cancel unfinished checkout.

No local secrets, live migrations, app-store builds, or deployments were changed.

## 5. API and feature flags

Signed-in `POST /v1/conversations/{id}/turns` requires
`{message, request_id}` and a bearer token. Completed responses are `ChatEnvelope`;
202 reports a pending turn; 409 reports conflicting request/message/context.
New request IDs must not replace pending retries. Signed-in callers cannot use
the legacy endpoints without durable request IDs. Guest legacy text shape remains.

Templates keep these false:
- LocalGo backend `SERVER_CART_ENABLED` (also enforces bound checkout/orders).
- Goer `GOER_CART_ENABLED`.
- Mobile `EXPO_PUBLIC_SERVER_CART_ENABLED`.

Configure Goer's `LOCALGO_API_URL` and mobile `EXPO_PUBLIC_GOER_API_URL` separately
from the LocalGo API URL. Secrets stay in their owning backend. Full local/staging
commands and activation order are in the runbook; use separate ports (8100/8000).

## 6. Verification and limits

Completed: **127 Goer pytest tests**, **116 pinned LocalGo backend tests**,
**8 tool smoke scripts**, **3 mobile Node cart-state tests**, **4 browser Node
cases**, and mobile `tsc --noEmit`. Models/Auth/HTTP/Stripe are stubbed. A
Starlette/httpx deprecation warning remains unrelated.

SQL was syntax-parsed only. There is no local PostgreSQL engine; no live RLS,
RPC, native-app sign-in, model-quality, or Stripe sandbox flow was verified.
Follow the runbook's staging checklist before activation.

Important production gaps:
- Goer journal/history uses one shared durable SQLite file, not per-host files.
  Multi-host deployments need a shared transactional persistence adapter.
- Define history retention/account-deletion cleanup and encryption. LocalGo Auth
  deletion cascades its new tables, not Goer's separate history file.
- No option selections, stock feed, merchant-hours/zone validation, new tax rules,
  or refund/support agent. Existing no-tax pricing needs business/legal review.
- Broader/fuzzy discovery search, tracing/evals, abuse limits, full streaming,
  real UI checks, and production rollout remain separate roadmap work.
- Bound payment locks intentionally do not expire blindly: processing/paid
  checkouts require reconciliation, not an automatic unlock/new payment.

## 7. Next step

Review/apply both migrations to staging, verify permissions and actual RPC
concurrency, then exercise real sign-in, chat/button parity, loss/restart recovery,
account switching, stale checkout, sandbox payment/cancel/dispatch replay.
Do not enable live flags or add more consequential agents before those checks.

## 8. Required working rules

Register file locks before editing; commit each focused change immediately.
Use one tool per file, keep domain logic deterministic, use integer CAD cents,
and keep credentials out of prompts/state/logs. Run required offline checks and
changed-tool smoke scripts. Never invoke a real provider from automated tests.
