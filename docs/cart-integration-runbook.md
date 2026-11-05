# Authenticated cart integration: setup and recovery

Updated 2026-11-04. This is the operational companion to section 16 of
[the architecture plan](localgo-delivery-architecture-plan.md), not a new roadmap.

## Status

The five integration milestones are implemented in code:

1. LocalGo verifies a Supabase token and exposes `GET /v1/session`. Goer derives
   conversation ownership from that verified UUID, never a body `user_id`.
2. Authenticated turns persist an immutable plan before a cart write and replay
   the same command/key after uncertain failure. A fenced lease prevents an old
   planner from writing after another worker takes over. Result, response, and
   history are journaled; response/history completion is atomic.
3. A structured classifier selects discovery, cart, or unsupported intent. The
   Cart Agent has read tools only; Python invokes the existing individual write
   tools after staging. Cart cards use the actual LocalGo response.
4. In opt-in server mode, mobile cart state is a cache of LocalGo. Buttons,
   old assistant executors, and the separate Goer assistant share the backend
   cart. Mobile pending requests are persisted before sending; no automatic
   offline assistant replay is allowed after uncertain writes.
5. Checkout locks an owned cart revision, persists an immutable server-priced
   quote, and binds Stripe metadata to its owner/order/revision/fingerprint.
   Explicit confirmation still opens PaymentSheet. Order publication verifies
   the exact paid amount and consumes the locked cart. Cancellation verifies
   Stripe cancellation before releasing the lock.

**Not activated or live-verified:** no SQL migration, deployment, real-model
call, native-app session, or Stripe sandbox payment was performed in this work.
All flags remain false in templates; no local secret files were changed.

Guest browser/CLI discovery still uses the 138-product JSON fixture. Signed-in
Goer turns use LocalGo's canonical 145-product catalog, scoped per request so
concurrent guest/signed-in turns cannot switch one another's repository. The
browser can render cart cards, but its provided UI is guest-only; the mobile
client supplies real Supabase sessions for authenticated cart interaction.

## Repositories and layout

### `goer-ai`

```text
src/goer_localgo/
  api/auth.py                         verified request-scoped identity
  domain/turns.py                     durable SQLite turn journal and fencing
  flow/authenticated.py               authenticated turn coordinator
  flow/routing.py                     typed, bounded classifier
  crews/cart_crew/                     read-only CartPlan producer
  integrations/localgo/cart_client.py cart HTTP adapter; private access token
  integrations/localgo/catalog_repository.py canonical catalog snapshot
  schemas/cart.py                     CartPlan and cart wire schemas
  schemas/chat.py                     product/cart card union
  tools/cart/
    get_cart.py                       one tool and input schema per file
    add_cart_item.py
    update_cart_line.py
    remove_cart_line.py
    clear_cart.py
    base.py                           private dependencies/shared helpers
```

### `LocalGo-Consumer-RN`

```text
backend/app/
  auth.py                              Supabase token verification
  routers/session.py                  identity endpoint
  routers/catalog.py                  canonical catalog endpoint
  routers/cart.py                     cart and active-checkout endpoints
  cart/{models,service,manager,repository}.py
  cart/checkout.py                    checkout snapshot/lock repository
  cart/payment_binding.py             exact Stripe quote verification
  routers/{payments,orders}.py        existing explicit checkout, now bound
src/
  lib/serverCart.ts                   typed cart transport and session checks
  store/cartStore.ts                  server cache + serialized mutations
  lib/checkoutSession.ts              stable checkout IDs and recovery
  lib/{payments,placeOrder,dispatch}.ts explicit confirmation/payment flow
  goer/authenticatedClient.ts          persisted request IDs, no offline replay
  goer/tools/serverCartExecutors.ts    old executors use the same cart API
  components/CartNotice.tsx            pending-request and checkout recovery UI
supabase/migrations/
  202611040001_customer_carts.sql
  202611040002_cart_checkout.sql
```

## Activation order

### 1. Prepare staging storage (manual, owner-controlled)

Review and apply both migrations in order to a **staging** LocalGo Supabase
project. They were parsed for SQL syntax but not executed locally. Verify:

- Authenticated users can read only their own cart and cannot write directly.
- Cart/checkout RPCs are executable by the service role only.
- First-write races serialize; revision and idempotency receipts are atomic.
- Checkout lock prevents edits; consuming a checkout clears that exact revision
  once, never a later cart. Receipt replay remains safe while checkout is locked.
- Canceled/processing/succeeded payment cases release/retain locks correctly.
- Account deletion cascades the new cart/receipt/checkout rows.

Do not deploy against production merely because offline tests pass. No migration
is automatically run at startup.

### 2. Configure LocalGo backend

Use `LocalGo-Consumer-RN/backend/.env` or deployment secrets:

```dotenv
SUPABASE_URL=<staging project URL>
SUPABASE_ANON_KEY=<public project key>
SUPABASE_SERVICE_ROLE_KEY=<server only>
SERVER_CART_ENABLED=true
STRIPE_SECRET_KEY=<sandbox secret>
STRIPE_PUBLISHABLE_KEY=<sandbox public key>
```

Keep the existing webhook and delivery configuration as required. The service
role and Stripe secret remain in LocalGo, never in Goer, the app bundle, or a
model prompt. The separate Goer service does not need the older Groq/RAG pipeline.
Do not turn off an existing configured feature without checking its callers.

Run from `LocalGo-Consumer-RN/backend` on a port separate from Goer:

```powershell
uv run --no-project --with-requirements requirements.txt python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

### 3. Configure Goer

Use `goer-ai/.env` or deployment environment:

```dotenv
MODEL=openai/gpt-4.1-mini
OPENAI_API_KEY=<provider key>
LOCALGO_API_URL=http://127.0.0.1:8100
GOER_CART_ENABLED=true
GOER_CONVERSATION_DB=<absolute durable SQLite file path>
GOER_ALLOWED_ORIGINS=http://localhost:8081
```

`GOER_ALLOWED_ORIGINS` is optional and comma-separated, for Expo web preview.
Native requests do not use browser CORS. Remote LocalGo URLs must be HTTPS;
HTTP is accepted only for loopback development. Environment values override
`.env` values. Start Goer from its repository root:

```powershell
uv run python -m uvicorn goer_localgo.api.main:app --host 127.0.0.1 --port 8000
```

The journal and conversations currently share one durable SQLite file. Multiple
processes on that host can coordinate through its transactions. **Separate
SQLite files on multiple service hosts are not a shared journal.** Use a
transactional shared store before multi-host production. Back up/encrypt this
file and define retention/account-deletion cleanup for Goer history before
using real customer data; backend account deletion does not delete Goer's file.

### 4. Configure the mobile app

Use `LocalGo-Consumer-RN/.env.local`:

```dotenv
EXPO_PUBLIC_API_URL=<LocalGo backend URL>
EXPO_PUBLIC_GOER_API_URL=<separate Goer URL>
EXPO_PUBLIC_SERVER_CART_ENABLED=true
EXPO_PUBLIC_SUPABASE_URL=<same staging project>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<public project key>
```

These contain public configuration only. The app obtains the customer's access
token from the existing Supabase sign-in session and forwards it per request.
Pending records contain IDs/commands, not access tokens or payment details.

For a physical device, use reachable development LAN URLs and bind the local
servers appropriately (`--host 0.0.0.0` on a trusted development network).
Loopback URLs on a phone refer to the phone, not the development machine.
Use HTTPS deployments for release builds. Preserve the installed Expo 54 stack;
no Expo/dependency upgrade was made. Stripe still requires the project's native
development build, not stock Expo Go.

The Goer launcher is shown in the tab layout only when server-cart mode and
`EXPO_PUBLIC_GOER_API_URL` are configured. Legacy force-fallback settings are
for the old demo pipeline; server cart mutations must not be replayed offline.
Demo cart contents are not silently merged into a signed-in cart.

## Runtime contracts

- `POST /v1/conversations` with a bearer token creates an owned conversation.
  Guest requests create a separate shared-demo-principal conversation.
- `POST /v1/conversations/{id}/turns` accepts `{message, request_id}` for signed-in
  users. The UUID must remain stable across retries. Same UUID/different message
  conflicts. Body identity is never accepted as authority.
- Completed duplicates replay the saved envelope. Pending turns return 202 with
  `detail.code = TURN_PENDING`; another message is blocked until reconciliation.
- Authenticated callers cannot use legacy chat endpoints without request IDs.
  Legacy guest endpoints ignore body `user_id`, preventing identity spoofing.
- Models can read catalog/cart data and propose one typed operation. Python
  attaches the revision/key, persists it, then executes one write. No cart agent
  can invoke payment, order placement, refunds, or dispatch.
- Backend writes require `Idempotency-Key`; unknown fields/prices/options are
  rejected. Checkout is a separate explicit user flow, not a model tool.

## Recovery behavior

- **Lost chat reply:** resend the exact message while signed into the same
  account. The client retains the request ID; server recovery replays the exact
  persisted command/key without generating another mutation.
- **Lost button reply:** use **Retry pending request** in the cart notice.
  New edits are blocked while a pending command is unresolved.
- **Expired session:** sign back into the same account, then reconcile the
  saved request. Invalid bearer tokens never downgrade to guest execution.
- **Account switch/logout:** caches clear immediately; generation checks prevent
  old responses/transcripts from entering the new account. Recovery records
  remain scoped to their original account. Recreated accounts cannot execute
  a pending button request owned by another UUID.
- **New chat:** the app refuses to discard an unresolved turn. After completion,
  New chat clears the conversation reference instead of reusing hidden history.
- **Checkout lock:** finish the same checkout or choose **Cancel unfinished
  checkout**. Cancellation refuses paid/processing intents and verifies provider
  cancellation before unlocking. Never bypass the lock with a local clear.
- **Changed tip/revision:** an unfinished checkout cannot be reused for different
  parameters. Reconcile or explicitly cancel it before starting another.
- **Changed catalog prices:** the backend rejects a newly prepared checkout if
  its cart snapshot no longer matches canonical prices. Edit/reprice the cart
  and confirm again; it does not silently charge a changed amount.
- **Paid but dispatch uncertain:** the checkpoint retains the same order ID.
  Retries retrieve the existing intent and idempotently publish/consume that
  order; they do not create another charge. Local history is idempotent by ID.
- **Rollback:** do not disable backend server-cart enforcement with pending paid
  checkouts. Bound payments are refused by the legacy path, not accepted with
  caller-controlled order contents. Re-enable/reconcile before rollback.

## Verification and remaining gates

Completed offline checks: **127 Goer tests**, **116 LocalGo backend tests**,
**8 tool smoke scripts**, **3 mobile cart-state Node tests**, **4 browser-script
Node tests**, and the mobile TypeScript check. SQL syntax was parsed; the tests
mock Supabase/Stripe/HTTP and are not proof of live database or native SDK flows.

Run staging scenarios before activation: real sign-in and expiry, cross-user
IDs, menu/search follow-ups, chat/button parity, rapid quantity edits, mixed
restaurants, lost-response/restart recovery, account switching, stale checkout,
sandbox success/decline/cancel/processing, dispatch replay, and migration RLS.
No automated test calls a paid model or real payment provider.

Current limitations: no product-option selections or stock feed; no new tax
rules; no support/tracking/checkout LLM specialist. The existing pricing module's
no-tax policy and the Goer history retention/deletion lifecycle must be reviewed
before production. The development feature flags are not a production-readiness
certificate.
