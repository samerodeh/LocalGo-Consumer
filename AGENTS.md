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

## Active work

| Label | Date | Files | Goal | Status |
|---|---|---|---|---|
| Agent | 2026-11-05 | src/goer/authenticatedClient.ts; src/goer/history.ts; src/store/goerStore.ts; src/components/goer/; supabase/migrations/; tests/client/; backend/README.md; AGENTS.md | Finish account-linked mobile history, preserve cart/payment safety, verify development integration | Active; existing Supabase is development-only; backend service-role/admin credentials missing; no production activation |

## Recent work

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
