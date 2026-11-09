# Authenticated cart integration: setup and recovery

Updated 2026-11-09 for the combined repository. This is the operational
companion to section 16 of
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

The selected client is the **existing LocalGo mobile app**, using its existing
**development-only** Supabase project. Account-linked display history, conversation
selection, explicit pending-turn retry and New conversation are also implemented.
A completed response is cached before cloud publication; a history-only retry
never sends another Goer/cart request. Historical cart cards never update a cart.

**Connected development checks (2026-11-06):** Auth and service-key validation
return 200. Service-role reads with `limit=0` succeed for all five expected
cart/checkout/history tables; the expected columns and four RPC names are exposed.
Public-key reads return 401 / `42501`, consistent with anonymous denial. These
checks confirm connectivity and expected schema exposure, not exact migration
application, SQL grants/policies, authenticated owner isolation or concurrency.
LocalGo records report user-run migrations; do not blindly reapply them.

The backend service key is now present and valid, superseding the earlier empty-key
handoff. No database-admin connection or designated test sessions were available.
The safety guard blocked private `.env` access during activation; no configuration,
accounts, migrations or payments were changed. Services respond on 8000/8100/8081,
but cart remains feature-gated. No native SDK/device is available for PaymentSheet.
Next: privately configure the non-secret URLs/flags below, restart the services,
and verify authenticated ownership/retries/history and native sandbox checkout.
Earlier guest real-model verification does not establish signed-in acceptance.

Guest browser/CLI discovery still uses the 138-product JSON fixture. Signed-in
Goer turns use LocalGo's canonical 145-product catalog, scoped per request so
concurrent guest/signed-in turns cannot switch one another's repository. The
browser can render cart cards, but its provided UI is guest-only; the mobile
client supplies real Supabase sessions for authenticated cart interaction.

## Service directories in this repository

### `goer/`

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

### Repository root

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
  goer/authenticatedClient.ts          persisted request IDs and completed-response recovery
  goer/history.ts                     owned cloud transcript transport/validation
  components/goer/GoerHistory.tsx     conversation list and selection
  goer/tools/serverCartExecutors.ts    old executors use the same cart API
  components/CartNotice.tsx            pending-request and checkout recovery UI
supabase/migrations/
  202611040001_customer_carts.sql
  202611040002_cart_checkout.sql
  202611050001_goer_history.sql
```

## Activation order

### 1. Prepare staging storage (manual, owner-controlled)

Review and apply all three migrations above, in order, to the **existing
development** LocalGo Supabase project; do not create a second project or use
production. A service-role HTTP key alone cannot apply DDL: use the owner's
Supabase SQL Editor or a private PostgreSQL/admin connection. All three execute
in isolated PGlite PostgreSQL tests, including RPC/RLS assertions. Connected development now exposes the expected
tables, columns and RPC names following user-run migrations; inspect the actual
policies/grants and migration state before applying anything again. Real
ownership/concurrency verification is still required. Verify:

- Authenticated users can read only their own cart and cannot write directly.
- Cart/checkout RPCs are executable by the service role only.
- First-write races serialize; revision and idempotency receipts are atomic.
- Checkout lock prevents edits; consuming a checkout clears that exact revision
  once, never a later cart. Receipt replay remains safe while checkout is locked.
- Canceled/processing/succeeded payment cases release/retain locks correctly.
- Account deletion cascades cart/receipt/checkout and cloud history rows.
- History SELECTs are owner-only; direct table writes and anonymous RPCs fail.
- `save_goer_history_turn` binds `auth.uid()`, accepts immutable exact replay,
  rejects changed messages/envelopes, and cannot overwrite another account.

Do not deploy against production merely because offline tests pass. No migration
is automatically run at startup.

### 2. Configure LocalGo backend

Use `backend/.env` or deployment secrets:

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

Run from `backend` on a port separate from Goer:

```powershell
uv run --no-project --with-requirements requirements.txt python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

### 3. Configure Goer

Use `goer/.env` or deployment environment:

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
`.env` values. Start Goer from `goer/`:

```powershell
uv run python -m uvicorn goer_localgo.api.main:app --host 127.0.0.1 --port 8000
```

The journal and conversations currently share one durable SQLite file. Multiple
processes on that host can coordinate through its transactions. **Separate
SQLite files on multiple service hosts are not a shared journal.** Use a
transactional shared store before multi-host production. Back up/encrypt this
file and define retention/account-deletion cleanup for Goer history before
using real customer data; backend account deletion does not delete Goer's file.
Supabase display history is separate from this authoritative reasoning/command
store: deleting or losing the SQLite file is not repaired by a cloud transcript.

### 4. Configure the mobile app

Use `.env.local`:

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

### 5. Verify account-linked history

Sign in, complete a turn, restart/reinstall the app and open **History**. Select
an older conversation, then use **New conversation**: old history must remain
available. Lists page 20 conversations; transcript loading is bounded to 50 recent
turns and the UI retains its latest 50 messages. Earlier messages are not currently
paged within a conversation. Resuming reasoning still requires the original Goer
SQLite database, not just a Supabase transcript.

Interrupt cloud history publication after a confirmed cart response. **Retry
pending turn** must publish the exact cached envelope without another Goer/cart
HTTP call. App restarts and A-B-A account switches must preserve that request ID.
Do not allow a new turn, reset or conversation switch while recovery is pending.

### 6. Order and check out from authenticated chat

The flagged mobile chat now intercepts checkout controls deterministically; these
commands are not agent payment tools and do not navigate to the Cart screen:

1. Ask Goer to add an available product, for example
   `Add one Cheese Pizza Slice from Al-Taib`.
2. Type `addresses` and `use address 1` to choose a verified saved destination.
   With no saved destination, type `deliver to <full street address and city>`,
   verify a geocoded suggestion and type `use address 1`. Searching does not save
   a destination; explicit selection saves it in the account-scoped address store.
   Out-of-zone/unverified results are excluded. Address loads/saves are fenced
   across account transitions.
3. Optionally type `tip $0`, `tip $2.00` or `tip 15%`.
4. Type `checkout`. Review items, destination, delivery fee, tip and CAD total.
   This stages a summary only; it does not pay. Address/tip/cart changes invalidate
   that summary.
5. Type the exact `CONFIRM ORDER <eight-character-code>` shown in that summary.
   Generic confirmation, an old code or a question does not authorize payment.
6. Complete Stripe's secure PaymentSheet/bank challenge, if required. Payment
   stays in the checkout flow; no separate Cart/Checkout screen is required.
   The chat then shows the real order reference or an honest recovery warning.
7. `cancel checkout` requests cancellation through the existing server recovery
   path. Paid/processing checkouts cannot be released by this command.

A strictly typing-only first-time card payment is **not implemented**: card
numbers must never be collected in chat. Existing descriptive saved-card records
are not chargeable Stripe tokens. Do not bypass PaymentSheet/bank authentication
or claim saved-method charging exists. Completed local checkout replies are
cached under the existing request UUID before cloud history publication; a
history-only retry must not invoke payment or the agent again. Before a typed
confirmation can pay, an owner/request-scoped local receipt records its exact
snapshot and stable order pin. Account-switch/restart recovery reconciles that
original order even without an in-memory summary; a consumed pin cannot create
a replacement payment. Concurrent waiters reuse one immutable response. These
local recovery receipts contain delivery information and currently have no
retention/deletion policy, alongside the other documented persistence gaps.

The typed sequence is covered by connected client-module tests with external
Auth/model/payment services doubled, not by a real signed-in native payment.
Latest offline checks: 127 Goer tests, 116 pinned backend tests, 36 mobile/SQL
cases (zero skips), TypeScript and Android JS/assets export pass. Tests include
wrong-code refusal, address hydration, A-B-A payment completion/overlapping
waiters and interruption before receipt/envelope caching. Export is not a native
build, PaymentSheet execution or connected Supabase/Stripe verification.
A read-only development-project check on 2026-11-05 returned `404 PGRST205` for
`customer_carts`, `customer_cart_checkouts`, `goer_conversations` and
`goer_history_turns`; these tables are not visible in the connected schema cache.
The backend service-role key is still empty. Apply/verify the three migrations
with owner-controlled admin access before activating customer flags.

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
- **History publication failure:** use **Retry pending turn**. The completed
  response is retained locally before publication, so this retries only the
  history RPC. Do not clear application data while recovery is pending.
- **New conversation:** the app refuses to discard an unresolved turn and locks
  synchronously against sends/restoration. It starts a new server conversation
  without deleting saved cloud history. **History** restores an owned transcript;
  restored cart cards are display snapshots, never executable cart state.
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

Latest rerun (2026-11-06): **127 Goer tests**, **122 pinned LocalGo backend tests**,
**36 mobile/SQL Node cases** (zero skips) and mobile TypeScript passed. The previous
Android JavaScript/assets export passed; it was not rerun during this verification. Goer's suite includes the 4 browser-script cases.
The 8 individual tool smoke scripts passed in the previous implementation session;
no tools changed in this session. The Android export is not a native build or
PaymentSheet runtime test.

The SQL case executes all three real migrations and tests owner RLS, restricted
RPC grants, immutable history replay, cart receipts/revisions, checkout locks,
quote/payment binding and one-time consumption in isolated PGlite PostgreSQL.
It does not verify connected Supabase, concurrent sessions or real Stripe. To run
that optional case without a project dependency (from the mobile repository):

```powershell
npm install --prefix "$env:TEMP\localgo-pg-check" --ignore-scripts @electric-sql/pglite@0.5.15
$env:LOCALGO_PGLITE_MODULE = "$env:TEMP\localgo-pg-check\node_modules\@electric-sql\pglite"
node --test tests/client/*.test.cjs
```

Without `LOCALGO_PGLITE_MODULE`, the database case explicitly skips; do not report
it as passed. Other Node cases use fake HTTP/storage with the real client modules.

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
