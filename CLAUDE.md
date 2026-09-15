# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**LocalGO Consumer** — a cross-platform (iOS + Android) food-delivery consumer app built with
**Expo + React Native + TypeScript**. It is a faithful port of the SwiftUI app at
`../LocalGOConsumer` (`LocalGoConsumer/`), rebuilt in React Native so a single codebase ships to
both App Store and Google Play. Design tokens, screens, data, and flows mirror the SwiftUI original.

## Stack

- **Expo SDK 54**, React Native 0.81, React 19.1 (SDK 54 so the released Expo Go app can run it — SDK 57 was too new for any published Expo Go)
- **expo-router** — file-based routing (`app/`), tabs + stack + modals
- **zustand** — state stores (the RN counterpart to the SwiftUI `@EnvironmentObject` view models)
- **@react-native-async-storage/async-storage** — local persistence: orders/addresses always (namespaced
  per owner email), plus accounts/session in demo mode (no Supabase env vars)
- **@supabase/supabase-js** — real accounts (`src/lib/supabase.ts`) when configured; `expo-crypto`
  salted, iterated SHA-256 (`src/lib/hash.ts`) is the demo-mode password fallback only
- **expo-linear-gradient**, **@expo/vector-icons** (Ionicons), **expo-font** (Barlow Condensed)

## Run

```bash
cd ~/projects/LocalGOConsumerRN
npx expo start
```

Then:
- **Phone** — a custom **dev build** (see the Expo Go warning below); the store Expo Go app can no longer load this project
- **iOS Simulator** — press `i`
- **Android Emulator** — press `a`
- **Browser** — press `w` (used for quick verification)

⚠️ **Expo Go can no longer run this app.** `@stripe/stripe-react-native` is a native module, so
checkout needs a custom dev build (`expo-dev-client` is installed). Use `npx expo run:android` or
an EAS dev-client build; scanning the QR with the store Expo Go app will fail on the Stripe
native module.

⚠️ Keep `expo` pinned to `~54.0.0` in `package.json`. `npx expo install` / `expo upgrade` will
happily jump to whatever the newest SDK is (57 as of writing) — see the SDK-54 note below.

## Layout

```
backend/                    ← Python/FastAPI backend (serves BOTH apps — see below)
app/                        ← expo-router routes
├── _layout.tsx             ← root: loads fonts, restores session, Stack.Protected auth gate,
│                              routes tapped pushes (delivery update → order, message → chat)
├── (auth)/                 ← login + signup (shown when logged out)
├── (tabs)/                 ← Home / Orders / Cart / Settings (shown when logged in)
├── order/[id].tsx          ← one order in full: timeline, pickup photo, receipt
├── order-confirmed.tsx     ← post-checkout celebration + the receipt just placed
├── restaurant/[id].tsx     ← full-screen menu (fullScreenModal)
└── address.tsx             ← delivery-address modal
src/
├── theme/theme.ts          ← colors, radii, Barlow font families (mirrors SwiftUI AppTheme)
├── types/                  ← shared TS types
├── data/                   ← static catalogs: partner, restaurants, Al Taib menu (73 items)
├── lib/                    ← supabase (accounts client) + dispatch (order bridge) + storage
│                              (AsyncStorage: orders/addresses always, demo-mode accounts) + hash (demo-mode KDF)
│                              + orderFormat (money/date/status presentation shared by all order screens)
├── store/                  ← zustand: auth, cart, orders, address
├── goer/                   ← chatbot client: transport, chat store, offline NLU, tool executors
└── components/             ← RemoteImage, DisplayText, GradientButton, OrderReceipt,
                               OrderStatusBadge, OrderTrackingStack (+ goer/ chat UI)
```

## Architecture notes

- **Auth gate** — `app/_layout.tsx` uses `Stack.Protected guard={isLoggedIn}` to swap the `(auth)`
  and `(tabs)` groups. `restoreSession()` runs on mount; per-user stores (orders, addresses) are
  re-scoped whenever `currentUser.email` changes.
- **State** — one zustand store per domain, mirroring the SwiftUI view models
  (`authStore` ↔ AuthViewModel, `cartStore` ↔ CartViewModel, `ordersStore` ↔ OrdersViewModel,
  `addressStore` ↔ AddressViewModel).
- **Accounts — dual-mode, mirrors the driver app** — `src/store/authStore.ts` keys every branch off
  `isSupabaseConfigured` (`src/lib/supabase.ts`). Configured: `supabase.auth.signUp/signInWithPassword/
  signOut/getSession`, with a best-effort profile-row insert into the shared project's `customers`
  table (`../LocalGo-driver/supabase/schema.sql`) after signup — same two-step pattern as the driver
  app's `drivers` insert. Unconfigured (demo mode): the original local flow, salted iterated-SHA256
  hashing (`src/lib/hash.ts`) + AsyncStorage (`src/lib/storage.ts`), unchanged. Either way `currentUser`
  ends up the same `StoredUser` shape, so nothing downstream (Settings, checkout) needs to care which
  mode is active.
- **Persistence** — orders/addresses are *always* local, namespaced by owner email
  (`src/lib/storage.ts`), regardless of auth mode — Supabase Auth still gives every account a stable,
  unique email, so `ordersStore`/`addressStore` didn't need to change when accounts went real.
- **One order id, end to end** — `placeOrder()` mints the id *before* payment and it is now used
  for **everything**: the Stripe idempotency key and metadata `order_id`, the shared `orders` row's
  primary key, the chat thread, the `data.orderId` on every push, and the local `OrderRecord.id`.
  It used to be that `ordersStore.record()` minted its own separate UUID, which meant a local order
  could not be matched to its server row at all — no live status in history, and a tapped
  notification had nothing to open. Anything that adds a per-order feature depends on this holding,
  so **never let `record()` generate its own id again.**
- **Order history + live status** — the Orders tab (`app/(tabs)/orders.tsx`) lists local orders,
  in-flight ones first (`isInFlight` in `src/lib/orderFormat.ts`); `app/order/[id].tsx` shows one in
  full. Records stay local and authoritative for contents and money; only the server-owned fields
  (`orderNumber`, `deliveryStatus`, `pickupPhotoURL`) are merged in, through the single
  `ordersStore.updateFromServer()` write path — fed by `syncDeliveryStatus()` (a direct Supabase
  read on launch, pull-to-refresh, and push taps) and by the realtime tracker. A null from the
  server never clears a field the device already knows. So the whole screen works offline and in
  demo mode, just without progress.
- **Money** — order records store amounts in **cents** (`ordersStore`) so totals can't drift from
  float rounding, matching the SwiftUI `OrderRecord`.
- **Payments — real Stripe, server-priced** — `src/lib/payments.ts` opens Stripe's PaymentSheet;
  `placeOrder()` charges *before* it records anything. The app never sends an amount: it posts
  item ids + quantities to `POST /payments/intent`, and `backend/app/pricing.py` reprices the cart
  from the backend's own menu copy and charges that. `POST /orders` then re-reads the PaymentIntent
  from Stripe and refuses (402) unless it succeeded and its metadata `order_id` matches — so an
  order cannot exist without a matching charge, and one charge cannot be replayed into many orders.
  The order id is generated before payment and doubles as the Stripe idempotency key and the row's
  primary key, which is what makes the post-charge dispatch retry safe. **Demo mode** (no
  `EXPO_PUBLIC_API_URL`) still simulates, with a `pi_demo_…` id — no backend, so no real money.
- **Order dispatch bridge** — after the local `record(...)` at checkout, the shared pipeline
  (`src/lib/placeOrder.ts`) calls `publishOrderToDispatch()` (`src/lib/dispatch.ts`), which POSTs
  the order to the **Python/FastAPI backend** (`backend/`, `POST /orders`). The backend re-validates
  the delivery location, computes the item summary, inserts the shared Supabase `orders` row
  (anon key, never chaining RETURNING — see the RLS gotcha in backend/app/routers/orders.py), and
  alerts drivers via push. **No longer best-effort** — since the card is charged first, a paid order
  that never reaches a driver is the worst outcome, so this is awaited and retried (0/0.8/2.5s) and
  a total failure surfaces to the user as a `warning` on an otherwise successful result. Retrying is
  safe because the order id is client-generated: a repeat insert collides on the primary key and the
  backend reports it as a duplicate success. Still a no-op unless `EXPO_PUBLIC_API_URL` is set. The inserted row is insert-only from this side;
  each driver's delivery progress lives in a driver-side `driver_orders` overlay table.
- **Delivery notifications — four beats, one story** — a customer gets a push at each milestone the
  driver marks: **accepted** ("driver heading to the restaurant", carries the ETA) → **picked_up**
  ("on the way") → **nearby** ("a few minutes away") → **arrived** ("your driver is here"), plus
  **delivered**. The copy lives in one table, `_CUSTOMER_MILESTONES` in
  `backend/app/routers/notify.py`; which driver status fires which push (and therefore which
  statuses are customer-visible at all) is `_STATUS_NOTIFY` in `backend/app/routers/orders.py`.
  `declined` is deliberately in neither — a driver passing on an order is private to that driver.
  Adding a milestone means touching both tables, `_STATUS_TIMESTAMP`, the `StatusBody` `Literal`,
  the `driver_orders` CHECK constraint in `schema.sql`, and the `DeliveryStatus` unions in **both**
  apps. Tapping a delivery push opens `app/order/[id]`; only a chat push opens `/chat` (it used to
  be that every push with an `orderId` opened the chat).
- **Pickup photo → the customer's inbox** — when the driver confirms pickup, the photo they take is
  uploaded to the public `order-photos` bucket, mirrored onto `orders.pickup_photo_url`, shown on
  the order screen, *and* emailed to the customer (`backend/app/mailer.py`, stdlib `smtplib`, no new
  dependency). The address comes from Supabase Auth's admin API — deliberately not copied onto the
  order row, where it would go stale. Best-effort throughout: with no `SMTP_*` configured
  (`EMAIL_CONFIGURED`, reported by `/health`) pickup behaves exactly as before, and a dead relay can
  never stop a driver advancing a delivery they've already made.
- **Delivery-location gate** — checkout is impossible without a *verified* delivery location.
  `src/lib/deliveryLocation.ts` defines the rule (non-trivial street line + real geocoded
  coordinates; (0,0) is the "never geocoded" sentinel) and is enforced in four places: the Cart
  screen (blocks the confirm dialog, routes to the Address screen), `placeOrder()` (hard gate for
  every entry point incl. Goer), `goerStore.stageOrder()` (Goer can't even stage a confirmation
  card), and server-side in the backend's `POST /orders` (422). `app/address.tsx` guarantees the
  invariant at the source: saving an address geocodes it (Photon autocomplete, GPS, or a save-time
  lookup) and refuses saves that can't be resolved to coordinates.

## Goer — the multi-agent ordering chatbot

**Goer** is the in-app AI assistant (floating button, bottom-right of Home and Cart) that can do
everything the UI can: browse the Al Taib menu, recommend, build the cart, set the tip, and run
checkout — all from chat.

**The agents run on the backend** (`backend/app/goer/`), ported from the SufraAI restaurant
chatbot. The app holds transport, chat state, the offline assistant, and the tool executors
(`src/goer/`) plus the UI (`src/components/goer/`). This is a change from the original design,
where the agent loop ran in the app bundle and the backend was a thin Anthropic proxy.

- **One turn, server-side** — `POST /goer/chat/stream` runs
  `guard_agent` (on-topic gate, fails open) → `route` (deterministic shortcuts for the hot paths,
  then an LLM classifier) → one of six specialists → a streamed reply. `router_agent.py` is the
  orchestrator; SufraAI leaves that file an unfinished stub, which is why its own `/chat` can't run.
- **Six specialists with visible handoffs** — Menu Concierge, Cart Manager, Checkout, Order
  Tracker, Dietary Advisor, Recommendations. The stream's first frame names who took the turn, and
  the app renders a divider when it changes. Each rebuilds its system prompt every call from the
  live cart/tip/address state the request carries.
- **Plan, then speak** — each specialist first extracts structured intent with a JSON-only model
  call, resolves it against the menu, and only then writes prose with the outcome already in the
  prompt (SufraAI's order-agent pattern). So the sentence can't describe something that didn't
  happen, and the reply can stream while the actions are already settled.
- **Two brains, one toolset** — `send.ts` routes a turn either to the backend
  (`agentLoop.ts` → `streamClient.ts`) or to the **offline rule-based NLU** (`localNLU.ts`: intent
  detection + fuzzy matching in `menuIndex.ts`). Both drive the *same* client-side tool executors
  (`tools/executors.ts`), so the app demos fully offline. Transport failures downgrade to the NLU
  mid-conversation (sticky per session, re-probes on next launch).
- **Actions, not tool-use blocks** — the cart is on-device zustand state, so a turn comes back with
  `actions` (`{tool, input}`) naming executors in `tools/executors.ts`; the app applies them after
  the text. That's the one place this departs from SufraAI, whose agents write the user's order
  straight to SQLite.
- **Checkout safety invariant** — no action can place an order. The strongest thing the Checkout
  agent can emit is `stage_order_confirmation`, which stages a snapshot (`goerStore.stageOrder`)
  and renders `OrderConfirmationCard`; the ONLY code path that places an order from chat is the
  card's Confirm button → `confirmStagedOrder()` → `src/lib/placeOrder.ts` (the same pipeline
  `cart.tsx` uses). Duplicate taps no-op via the staged→placing status guard, and a cart-hash check
  marks the card stale if the cart changed after staging.
- **Retrieval** — `app/goer/rag.py`: two persistent ChromaDB collections (menu items, FAQs)
  embedded with sentence-transformers' `all-MiniLM-L6-v2`, as SufraAI does. That package needs
  torch, which has no win-arm64 wheels, so it falls back to Chroma's bundled ONNX embedder
  (downloaded once, ~80 MB, cached under `~/.cache/chroma`). `build_index()` runs at startup and
  upserts, so a menu edit only needs a restart.
- **Recommendations** — `app/goer/recommender.py` reads Apriori association rules and popularity
  rankings mined from an Al Taib order history (`scripts/train_recommender.py`, the script form of
  SufraAI's training notebook). No model call: the Recommendations agent picks with the rules and
  the LLM only writes the pitch. Also exposed model-free at `GET /goer/recommendations`.
- **Data** — `app/goer/data/menu.json` is generated from `src/data/menu.ts` by
  `scripts/build_menu_dataset.py`, which derives the allergens, diet tags, and Arabic names the
  agents need. **`src/data/menu.ts` stays the single source of truth for ids, names, and prices —
  re-run the script after editing it.**
- **Model** — Groq, `llama-3.1-8b-instant` by default (`GOER_MODEL` in `backend/.env`). Fast enough
  to run the guard, the router, and a specialist back to back within one turn. `GROQ_API_KEY` lives
  only in the backend env, never in the client bundle. Without a running backend the app stays in
  offline-NLU mode; `EXPO_PUBLIC_GOER_FORCE_FALLBACK=1` forces it for testing.
- **Streaming on RN** — uses `expo/fetch` (WinterCG, SDK 52+) because RN's built-in fetch can't
  expose `response.body`; the SSE parser is hand-rolled in `streamClient.ts`. No new dependencies.
- **Dead reference** — `supabase/functions/goer-chat/` (the original Deno edge function) is no
  longer called by anything and predates two rewrites. Delete it when convenient.

## Backend status (Python/FastAPI, as of 2026-07-16)

**The backend code is Python/FastAPI** (`backend/` in this repo — one service backs this app AND
the driver app, whose repo is the sibling directory `../LocalGo-driver` — note the folder is NOT
named `LocalGODriverRN`; that's only the Expo slug, and following it as a path leads nowhere).
It replaced the TypeScript/Deno edge functions and the apps' direct
PostgREST data access: order dispatch (`POST /orders`, with server-side delivery-location
validation), the driver feed/claim/status endpoints and `GET /orders/history` (a driver's completed
deliveries, `?scope=today|all`), the Goer chatbot in full
(`POST /goer/chat[/stream]` plus its menu/FAQ/recommendation endpoints), and
push notifications (`POST /notify`). Run it with `uvicorn app.main:app --port 8000` from
`backend/` (Python **3.12** venv — 3.14 on this machine breaks httpx/asyncio with
`No module named 'concurrent.futures.thread'`); see `backend/README.md`. Apps find it via
`EXPO_PUBLIC_API_URL` in `.env.local` (LAN IP for physical devices).

Supabase stays underneath as the managed Postgres + Auth provider (project:
`sxednzdbbfjxdvezmouf.supabase.co`) — the apps still use `supabase-js` for **Auth sessions,
realtime, and chat only**; all other data access goes through FastAPI, which forwards the caller's
JWT to PostgREST so every RLS policy applies unchanged. Schema lives at
`../LocalGo-driver/supabase/schema.sql` (idempotent — re-run the whole file after any change).
Verified end-to-end on 2026-07-16: order POSTed through FastAPI → appeared in the driver feed →
accept (incl. the 409 lost-race path) → delivered.

## EAS Build (Android)

`app.json` → `android.package: "com.samerodeh.localgoconsumer"`. `eas.json` has a `preview`
profile (internal-distribution `.apk`, not the Play Store `.aab`).

```bash
npx eas-cli build --platform android --profile preview
```

⚠️ **Critical gotcha already hit once:** EAS Build uploads the project archive respecting
`.gitignore`, so `.env.local` (gitignored, real credentials) **never reaches the cloud build** —
the resulting APK silently falls back to whatever "unconfigured" behavior the code has. Fixed by
putting the same `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` directly in `eas.json`'s `build.preview.env`
block (safe — these are publishable/anon keys, protected by RLS not secrecy). **If you ever rotate
the Supabase key or `eas.json` loses that `env` block, rebuilds will silently break dispatch again**
— always check the build log for `No environment variables ... found` as the tell.

`npx expo start --tunnel` needs `@expo/ngrok`; the global-install path fails with exit 243 on this
machine (npm permissions) — install it **locally** instead: `npm install @expo/ngrok@^4.1.0 --legacy-peer-deps`.
- **Design system** — always use `colors`/`radius` from `src/theme/theme.ts` and `<DisplayText>`
  for Barlow Condensed headings; don't hardcode hex values or font names.

## Data

**Two** partners have real menus (`hasMenu: true`): **Al Taib** (`al-taib`, 73 items) and
**Chateau Kabab** (`chateau-kabab`, `ck-` ids). All 145 items live in `src/data/menu.ts` with
remote product photos. Other partners render a "coming soon" state.

Two generated files derive from `src/data/menu.ts`, and **both must be regenerated after editing
it**:

- `backend/app/menu_prices.json` — ids, names, and **integer cents**, read by `pricing.py` to
  decide what a customer is charged. Committed and reviewable in a diff on purpose. Regenerate with
  `python scripts/build_menu_prices.py`. Stale prices here mean charging the wrong amount.
- `backend/app/goer/data/menu.json` — the larger Goer artifact (allergens, diet tags, Arabic
  names). Regenerate with `scripts/build_menu_dataset.py`. Never edit by hand.

Pricing deliberately does **not** read Goer's copy: that file was untracked and covers Al Taib
only, so pointing the money path at it meant a deploy that could price nothing and a Chateau Kabab
order that could never check out.

## Testing

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest          # 68 tests, ~0.3s, no network
```

The suite covers the money path (pricing, the payment gate, account deletion) and the delivery
path: that every milestone both mirrors onto the shared order row *and* pushes the customer
(`test_delivery_status.py`), that `GET /orders/history` scopes by forwarded token rather than the
forgeable `sub` claim (`test_order_history.py`), and that the pickup email carries the photo and
never raises into the status endpoint (`test_mailer.py`).

It is **hermetic by design**: an autouse fixture in `tests/conftest.py` forces every service to
"unconfigured" and neuters `stripe.api_key`, so no test can read `backend/.env` or reach a real
API. That fixture exists because without it a test meant to exercise the unconfigured path instead
hit live Stripe and created a real PaymentIntent. `SMTP_*` is stubbed out there for the same
reason, one degree worse: a configured relay would let a test actually mail someone.

`.github/workflows/backend-tests.yml` runs it on every push and PR touching `backend/`. Render
auto-deploys `main` regardless of the result — turn on branch protection requiring this check if
you want the gate to actually block a bad deploy.

**Not covered:** the whole React Native side. No `jest-expo`, no component tests. The
delivery-location gate and the Goer checkout invariant are enforced in the app and verified only by
hand.

## Known gaps vs. the SwiftUI app (intentional, for a real backend later)

- No social sign-in. The non-functional Apple/Google buttons were removed from `login.tsx` before
  Play review — a control that does nothing is a rejection risk. Email/password is the only path.
- Demo-mode-only password hashing uses iterated SHA-256 (expo-crypto has no PBKDF2) — irrelevant
  when Supabase is configured (the normal case), since Supabase Auth owns password storage then.
- Address entry has autocomplete + GPS via Photon geocoding (`src/lib/geocoding.ts`) but no map
  picker; saved addresses are guaranteed to carry verified coordinates (see the
  delivery-location gate above).
- No profile-editing UI (Settings only displays name/email + sign-out), so `customers` has no
  update RLS policy — matches the driver app's `drivers` table, which has the same gap.
