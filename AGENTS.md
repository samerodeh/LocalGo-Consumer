# LocalGO Consumer — agent guide

## Before changing code

- Read the exact versioned Expo docs at https://docs.expo.dev/versions/v57.0.0/ before writing Expo or React Native code.
- Treat `package.json` as the source of truth for installed dependency versions. Do not upgrade Expo, React Native, or related packages unless the task explicitly calls for it.
- Inspect the relevant route, store, and shared type before editing. This is an Expo Router app: routes live in `app/`, domain state lives in `src/store/`, and shared types live in `src/types/`.

## Project conventions

- Use TypeScript and preserve the existing Expo Router file-based routing structure.
- Use Zustand stores for cross-screen domain state; keep UI-specific state local where practical.
- Use design tokens from `src/theme/theme.ts` and `DisplayText` for Barlow Condensed headings. Do not introduce hard-coded colors or font-family names when a token/component exists.
- Monetary values in persisted orders are integer cents. Do not use floating-point values for stored totals.
- Scope persisted consumer data by the active account email, following the existing storage/store patterns.
- Keep secrets out of the client and git. Only `EXPO_PUBLIC_*` configuration belongs in the Expo app; server-only keys belong in Supabase secrets.

## Goer assistant

- Goer's **agents run server-side** in `backend/app/goer/` (guard → router → six specialists, ChromaDB retrieval, Groq). Prompts, routing, and menu knowledge belong there — not in the app bundle.
- The app side is `src/goer/` (transport, state, offline NLU) and `src/components/goer/` (UI). The legacy online/offline paths share `src/goer/tools/executors.ts`. In opt-in server-cart mode those executors and ordinary buttons use `/v1/cart`; Zustand is a cache, not another source of truth.
- New authenticated CrewAI chat lives in the sibling `../goer-ai` service, selected with `EXPO_PUBLIC_GOER_API_URL` and `EXPO_PUBLIC_SERVER_CART_ENABLED`. That path receives completed backend outcomes, not client mutation actions: never execute its cart changes again locally or replay an uncertain request through offline NLU. Preserve pending request/order IDs across retries and fence account transitions.
- A backend turn returns `actions` naming those executors. Adding a capability means adding the executor here **and** teaching a specialist to emit it; never let the two drift.
- Chat checkout must remain confirmation-gated: stage an order first, then place it only through the explicit confirmation flow. No server action may place an order. Do not bypass the stale-cart or duplicate-placement guards.
- After editing `src/data/menu.ts`, re-run `backend/scripts/build_menu_dataset.py` and `backend/scripts/build_menu_prices.py`; commit derived changes. Signed-in CrewAI discovery uses `/v1/catalog/products` from the committed authoritative pricing/catalog artifact.
- Server checkout locks a cart revision and binds the immutable quote to owner/order/revision/fingerprint. Only explicit user confirmation can pay. Never unlock paid/processing checkouts, clear a cart locally after payment, disable binding on rollback, or create a fresh order ID merely because a response was lost.
- Account-linked display history uses `src/goer/history.ts` and `202611050001_goer_history.sql`. Owner-only SELECT/RPC access, immutable exact turn publication, and the cached completed response must survive retries. A history-only retry must not send Goer/cart HTTP again; historical cart cards must not update current cart state.
- Serialize persisted session reads/writes across generations. Recheck ownership after async conversation creation and before persistence. New conversation locks synchronously against sends/restoration and preserves cloud history. Supabase transcripts do not replace the sibling Goer's SQLite reasoning/command journal; keep that database to resume a conversation.

## Active work

| Label | Date | Files | Goal | Status |
|---|---|---|---|---|
| Agent | 2026-11-09 | AGENTS.md; README.md; backend/README.md; goer/; .github/workflows/goer-tests.yml; .github/workflows/app-tests.yml; .easignore; render.yaml | Import Goer history into the LocalGo repository and wire independent builds | Active |

## Recent work
- 2026-11-08: Added the one-hour automatic refund path for paid server-cart
  checkouts without a dispatch order. The new migration serializes refund claims
  with order inserts and records the provider refund ID; the backend verifies
  the bound charge, rechecks order absence, and reconciles existing Stripe refunds
  on retry. Mobile blocks checkout reuse during refunding. Default event scan is
  30 days; auto mode requires a 60-minute grace. Backend 128 tests, 45 client/SQL
  tests with zero skips, and TypeScript pass. No connected migration, live refund,
  production scheduler, or native device test was performed. Apply the migration,
  configure an hourly scheduled run and alert, then validate with Stripe test mode.
- 2026-11-08: Added a read-only Stripe succeeded-event audit with a 15-minute
  race grace, 48-hour scan window, deduplication, service-role order checks and
  nonzero exit for missing or uncertain orders. All 125 backend tests pass.
  No live Stripe call, refund, scheduler or order publication was performed.
  Scheduling and paid-without-order disposition still need an owner choice.
- 2026-11-08: Store profile now selects the EAS production environment and
  enables server cart without hardcoding development service URLs. A pre-install
  guard rejects missing/invalid public endpoints or a disabled server cart;
  simulated missing and valid configurations passed. Read-only EAS CLI queries
  under the linked Expo account showed no production variables at project or
  account scope, so no release build was attempted. Production endpoints must be
  configured in this linked EAS project; native payment still needs device tests.
- 2026-11-06: Added development-only internal APK/dev-client EAS profile, excluded root/nested private environment files from uploads, and documented owner setup plus native acceptance in `docs/android-development-build.md`. TypeScript and 43 client/SQL tests pass (zero skips). No EAS upload/build, credentials, private configuration, payments or production activation changed. Owner SQL results, Expo project access and a device remain required.
- 2026-11-06: Plain-sentence address/postal inputs now reuse verified geocoding and explicit address selection; empty/oversized/unmatched inputs cannot reach the model or authorize payment. TypeScript and 43 client/SQL tests pass with zero skips. Goer regression suite: 172 passed, 5 Postgres cases skipped (no disposable database configured). Local services 8000/8100/8082 returned 200. Native payment remains unverified.
- 2026-11-06: Read-only development checks validate the configured service key
  (Auth admin 200), service-role `limit=0` access to all five expected tables,
  expected columns and four exposed RPC names. Anonymous table reads fail with
  401 / `42501`. User-run migrations are recorded, but exact policies/grants,
  owner isolation/concurrency still require connected acceptance; do not blindly
  reapply migrations. Reran 122 pinned backend tests, 36 mobile/SQL cases with
  zero skips, mobile TypeScript and sibling's 127 Goer tests successfully.
  Private `.env` access was blocked by the safety guard during activation, so
  no flags, secrets, accounts, schema or payments changed. Services 8000/8100/8081
  respond; cart remains disabled. No designated test sessions/admin SQL connection
  or native SDK/device available. Follow sibling runbook for private URL/flag
  configuration, restart and real authenticated/native sandbox acceptance.

- 2026-11-06: Added support for `sb_secret_`/`sb_publishable_` API keys in shared
  backend request headers; modern keys use only `apikey`, while real user JWTs
  retain Bearer authentication/RLS and legacy JWT API keys remain compatible.
  Auth-admin mail/account calls now reuse the same header logic. All 122 pinned
  backend tests pass, including six key-format/identity cases. Keep the existing
  `SUPABASE_SERVICE_ROLE_KEY` variable for the new backend-only secret; no secrets
  or activation flags were changed. Restart after private `.env` setup. Read-only
  connected checks now return permission-denied rather than missing-table errors
  for cart/checkout/history, following user-run migrations; actual owner/service
  grants, concurrency and native checkout still require connected verification.

- 2026-11-05: Implemented deterministic typed checkout in authenticated Goer chat:
  address search/explicit selection, tip, full CAD summary, exact confirmation
  code and cancel command; no Cart-screen navigation or model payment tools.
  Stripe secure entry/bank verification still uses native PaymentSheet; no
  chargeable saved-method or strictly typing-only first-time payment exists.
  Durable original-order receipts and stable-pin enforcement recover real
  outcomes across A-B-A switches/restarts/storage interruption without creating
  replacement payments. Overlapping waiters reuse the first immutable envelope.
  Serialized per-owner address loading/edits prevents hydration overwrites.
  Recovery review fixes verified; 36 mobile/SQL cases (zero skips), TypeScript,
  Android JS/assets export and 116 pinned backend tests pass; sibling Goer 127
  tests pass. Tests isolate external Auth/model/payment, not a connected native
  checkout. Dev Supabase cart/checkout/history tables still return `404 PGRST205`;
  backend service-role key remains empty. No flags, secrets, live migrations,
  signup or PaymentIntent/charge changed. Real account/admin/device access is
  still required before claiming the user's end-to-end acceptance goal complete.
  Refreshed Metro listens on 8081; backend process override uses current Wi-Fi
  `192.168.2.26:8100`, not the stale `.env.local` LAN address. Recheck on restart.

- 2026-11-05: Finished gated mobile account-linked display history: immutable
  owner-scoped Supabase publication, conversation picker, New conversation and
  explicit Retry pending turn. Completed responses persist before cloud history;
  outage/restart retry does not resend cart work. Added migration
  `202611050001_goer_history.sql`, generation-fenced/serialized session storage,
  A-B-A async isolation and synchronous reset locking through final callbacks,
  including synchronous subscribers. Final 22 Node cases and TypeScript reran
  successfully after that last fence check. Historical cart cards are
  display-only. UI keeps its latest 50 messages; older in-thread paging is absent.
  Latest checks: 22 mobile/SQL Node cases (zero skips), TypeScript, Android JS/assets
  export, 116 pinned backend tests; sibling Goer 127 tests. All three migrations
  and RPC/RLS assertions execute in isolated PGlite PostgreSQL, not connected
  Supabase/concurrency. Android export is not a native build/runtime test.
  Read-only checks verified Auth availability and Stripe `livemode=false`;
  no signup, model, PaymentIntent/charge, live migration or flag/secret changes.
  The user chose this mobile app and the existing development-only Supabase.
  **Next:** supply the backend service-role key privately and use the project's
  SQL Editor/admin connection to apply all three migrations in timestamp order;
  then configure development-only URLs/flags and verify real account/history,
  chat/button parity and explicit Stripe sandbox checkout/recovery. No production
  activation is authorized. Follow sibling `docs/cart-integration-runbook.md`.
- 2026-11-04: Implemented all five cart integration milestones with the separate
  Goer service: verified `/v1/session`, canonical 145-product catalog, server-cart
  cache for buttons/executors/chat, persisted pending requests and checkout IDs,
  account-switch fences, grounded cards, and explicit revision-bound checkout.
  Added migration `202611040002_cart_checkout.sql`, immutable quote/Stripe
  fingerprint verification, owned status/cancel recovery, idempotent order
  publication/consumption, and refusal of unsafe legacy downgrade. Feature flags
  default false. Checks: 116 pinned backend tests, mobile TypeScript, and 3 Node
  state cases pass. No migrations, real provider calls, native builds, or live
  deployments were performed; staging/RLS/Auth/Stripe verification remains.
  Setup is documented in the sibling Goer cart integration runbook.
- 2026-11-04: Added verified customer Auth helper, pure server-priced cart
  service, revision/idempotency manager, Supabase repository, `/v1/cart` routes,
  and migration `supabase/migrations/202611040001_customer_carts.sql`. Price
  artifact now carries explicit merchant IDs for all 145 menu items. 109 backend
  tests pass using pinned requirements. SQL syntax parsed; live migration/RLS
  execution is unverified and no migration was applied. Existing mobile cart,
  old Goer executors, and checkout remain unchanged; synchronize them before
  enabling server-cart chat. Separate Goer service has individual HTTP tools
  and an opt-in CartCrew, not yet enabled on its demo chat routes.

## Verification

- Run the narrowest relevant check after changes. For app-flow changes, start Expo and exercise the affected route when feasible.
- Preserve the current working-tree changes; this repository may already contain user work in progress.
