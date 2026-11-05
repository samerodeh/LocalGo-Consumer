# LocalGO Backend (Python / FastAPI)

The single backend service for **LocalGOConsumerRN** and **LocalGODriverRN**.
It replaces the old TypeScript/Deno Supabase edge functions (`goer-chat`,
`notify-push`) and the apps' direct Supabase data access. Supabase remains the
underlying Postgres + Auth provider; this service is the only backend *code*.

It also hosts **Goer** in full — the consumer app's multi-agent ordering
chatbot. Guard agent, router, six specialists, ChromaDB retrieval over the menu
and FAQ, and the Apriori recommender all live in `app/goer/`; the phone only
executes the cart tool calls a turn comes back with. See "Goer" below.

## Endpoints

| Method | Path                   | Caller   | What it does |
|--------|------------------------|----------|--------------|
| GET    | `/health`              | anyone   | Config/liveness probe |
| POST   | `/orders`              | consumer | Validates the delivery location server-side, computes the item summary, inserts the dispatch row, alerts drivers |
| GET    | `/orders/feed`         | driver   | Unclaimed + own orders merged with the driver's `driver_orders` overlay (camelCase, ready for the app) |
| POST   | `/orders/{id}/accept`  | driver   | Atomic claim; `409` when another driver won the race; notifies the customer |
| POST   | `/orders/{id}/status`  | driver   | Upserts the driver's private overlay status (declined / picked_up / delivered) |
| POST   | `/goer/chat`           | consumer | One Goer turn: guard -> router -> specialist. JSON in, JSON out |
| POST   | `/goer/chat/stream`    | consumer | The same turn as SSE — reply tokens, then the tool calls to run |
| GET    | `/goer/menu`           | consumer | The enriched menu (allergens, diet tags, alternatives) agents reason over |
| GET    | `/goer/faq`            | consumer | The FAQ knowledge base |
| GET    | `/goer/recommendations`| consumer | Apriori/popularity picks for a cart — deterministic, no model call |
| GET    | `/goer/health`         | anyone   | Goer's model, embedder, and index sizes |
| POST   | `/notify`              | both     | Push dispatch; recipients derived server-side from the order row |

Driver endpoints require the driver's Supabase Auth access token as
`Authorization: Bearer <jwt>`; the token is forwarded to PostgREST so all RLS
policies in `../../LocalGODriverRN/supabase/schema.sql` apply unchanged.

## Server-owned carts (new, opt-in integration)

The new cart API is separate from the existing phone-owned cart. It is **not
wired into the mobile store, existing Goer action executors, or checkout yet**.
Do not activate a server-side cart assistant in the app until all those callers
read the same cart; otherwise the phone and server will show different contents.

### Deployment prerequisites

1. Review and apply `supabase/migrations/202611040001_customer_carts.sql` from
   the repository root to the shared Supabase project. It creates two new
   tables and an atomic commit RPC; it does not modify existing order tables.
2. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
   `SUPABASE_SERVICE_ROLE_KEY` on this backend only. Never send the service key
   to Goer, the mobile app, or a browser.
3. Every request must carry the customer's real Supabase Auth access token.
   The backend resolves it through `/auth/v1/user`; request bodies cannot set
   an owner. RLS allows authenticated users to read only their cart. All direct
   user writes and execution of the commit RPC are revoked; the backend alone
   commits validated snapshots with the service role.

This migration was syntax-parsed locally, **not applied to a live database**.
Repository/RPC behavior is mocked in the offline suite. Validate the migration,
RLS, and concurrent commits against a staging Supabase/PostgreSQL instance
before deployment. No infrastructure was provisioned.

| Method | Path | Body |
|---|---|---|
| GET | `/v1/cart` | none |
| POST | `/v1/cart/lines` | `{product_id, quantity, cart_revision}` |
| PATCH | `/v1/cart/lines/{product_id}` | `{quantity, cart_revision}` |
| DELETE | `/v1/cart/lines/{product_id}` | `{cart_revision}` |
| POST | `/v1/cart/clear` | `{cart_revision}` |

All writes require `Idempotency-Key` (1–200 letters, digits, `.`, `_`, `:`, or
`-`). Read the cart first for its revision. Replaying the same key and body
returns the original response without another change, even after later edits;
reusing the key for a different command returns `IDEMPOTENCY_CONFLICT` (409).
Concurrent writes from the same revision cannot both commit. The SQL function
locks per owner, checks the receipt before the revision, then writes cart and
receipt in one transaction. Receipts are retained until account deletion; add
an explicit retention policy before production, preserving the retry window.

Responses contain `revision`, `merchant_id`, `currency: CAD`, `lines`,
`subtotal_cents`, `delivery_fee_cents`, and `total_cents`. Lines use product IDs
(the stable line identity), quantities, names, and integer-cent unit/line prices.
LocalGo recomputes prices on every edit using `app/pricing.py` and explicit
restaurant metadata in `app/menu_prices.json`. Reading returns the last committed
snapshot; checkout must still reprice and bind to the cart revision when it is
integrated. The existing payment/order flow is unchanged.

V1 supports single-restaurant carts, quantities 1–99, at most 50 distinct lines,
and the existing $1,000 order limit. Unsupported options, notes, client prices,
and client merchant/owner fields are rejected rather than silently ignored.
Fees follow the existing pricing module ($5 delivery for nonempty carts, no tip
in the cart API); this is not a checkout quote and does not introduce tax rules.
Regenerate the price artifact after menu changes with
`python scripts/build_menu_prices.py` and restart the backend.

Errors use `detail: {code, message}` for cart business/storage failures:
`CART_REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CART_MERCHANT_MISMATCH`,
`CART_LINE_NOT_FOUND`, `ITEM_UNAVAILABLE`, `CART_LIMIT_EXCEEDED`, or
`CART_UNAVAILABLE`. Authentication failures are 401, unavailable authentication
or storage is 503, and invalid input is 422. There is no local-state fallback.

Structure: `app/auth.py` verifies identity; `app/cart/models.py` defines schemas;
`service.py` is pure pricing/validation; `manager.py` handles request replay;
`repository.py` calls PostgREST; `app/routers/cart.py` is the HTTP surface.

Verification: **109 backend tests pass** under the pinned requirements with
stubbed Auth/PostgREST/Stripe calls. Run `python -m pytest tests -o addopts='' -q`.
The new cross-repository CrewAI integration lives in `../goer-ai` relative to
this repository root, not in the older `app/goer/` implementation.

## Run

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # then fill in the values
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Point both apps at it with `EXPO_PUBLIC_API_URL` in their `.env.local`
(use your machine's LAN IP, not localhost, for a physical device):

```
EXPO_PUBLIC_API_URL=http://192.168.x.x:8000
```

## Environment

See `.env.example`. Everything degrades gracefully: no `GROQ_API_KEY` means
the chat endpoints return 503 and the app falls back to its on-device
assistant, no `SUPABASE_SERVICE_ROLE_KEY` means push notifications are skipped,
no Supabase values means order endpoints return 503 (the apps then behave
exactly like demo mode).

`app/config.py` calls `load_dotenv()` on `backend/.env`, which is a no-op when
the file is absent — so in a deployed environment the same values are read
straight from the process environment. No code change is needed to deploy.

## Deploy

A LAN IP only works while your phone is on your Wi-Fi and `uvicorn` is running.
An installed APK needs a public HTTPS URL — which also sidesteps Android's
cleartext-HTTP block in release builds. Two ready-made configs, pick one:

- **Render** (`render.yaml`, repo root) — genuinely free, no card required.
  Trade-off: the free instance sleeps after ~15 min idle and takes 30-50s to
  wake on the next request. Good for testing the fix cheaply first.
- **Railway** (`railway.toml`, this dir) — no sleep/cold-start, ~$5/mo in
  practice at this traffic level (see below). Better once you're past testing.

### Render (test this first)

No CLI needed — Render deploys from your GitHub repo directly:

1. Push this branch (`render.yaml` must reach GitHub — Render reads it from
   there, not from your local disk).
2. [dashboard.render.com](https://dashboard.render.com) → **New** → **Blueprint**
   → connect the `LocalGo-Consumer-RN` repo. Render finds `render.yaml` at the
   repo root automatically and builds only `backend/` (`rootDir` in the file).
3. It will prompt for the env vars marked `sync: false` in `render.yaml`
   (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, etc. — same keys as `.env.example`).
   Nothing secret is in the committed file.
4. After the first deploy, copy the assigned URL
   (`https://localgo-backend-xxxx.onrender.com`).

```bash
curl https://localgo-backend-xxxx.onrender.com/health
# first hit after idle can take 30-50s (cold start) — that's expected on free
```

Wire that URL into both apps the same way described below for Railway.

### Railway (once you're past testing)

Config lives in `railway.toml`: `$PORT` binding, `/health` healthcheck, one
replica (see the comment there — the rate limiter is in-process).

```bash
npm i -g @railway/cli
railway login                       # opens the browser
cd backend                          # deploy THIS dir, not the repo root
railway init                        # first time only
railway up
railway domain                      # -> https://<name>.up.railway.app
```

Set the env vars in the Railway dashboard (Variables tab) — the same keys as
`.env.example`. **`.env` is gitignored and is never uploaded**, exactly like
`.env.local` and EAS: nothing carries your secrets to the cloud but you.

| Variable | Needed for |
|----------|-----------|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | order endpoints (503 without) |
| `SUPABASE_SERVICE_ROLE_KEY` | push + customer-facing status mirroring |
| `GROQ_API_KEY` | Goer's agents (the app falls back to offline NLU without) |
| `GOER_MODEL` | optional override, defaults to `llama-3.1-8b-instant` |
| `GOER_TEMPERATURE` / `GOER_MAX_TOKENS` / `GOER_MAX_HISTORY` | optional Goer tuning |
| `CHROMA_PATH` | optional; where the retrieval index persists |

Verify, then wire the apps to the deployed URL:

```bash
curl https://<name>.up.railway.app/health
# {"ok":true,"supabaseConfigured":true,"pushConfigured":true,"goerConfigured":true}
```

Put that URL in `EXPO_PUBLIC_API_URL` in **both** apps' `.env.local` *and* in
**both** `eas.json` files under `build.preview.env` — EAS never uploads
`.env.local`, so a var that lives only there is compiled into the APK as
`undefined`, and `dispatch.ts` silently no-ops. That is exactly how orders went
missing from builds while working fine on localhost.

⚠️ **Before exposing this publicly**, note that `POST /orders` and the
`/goer/chat*` endpoints take no auth — fine on a laptop, but on a public URL
anyone who finds it can inject orders into the driver feed or spend your Groq
quota (chat is rate-limited to 20/min per caller key, which a rotating caller
defeats). See the security note in the root `CLAUDE.md`.

## Goer

The chatbot's whole pipeline is server-side, ported from the SufraAI restaurant
chatbot:

```
POST /goer/chat[/stream]
  -> guard_agent      on-topic gate (JSON verdict, fails open)
  -> route            deterministic shortcuts, then an LLM classifier
  -> one specialist   concierge | cart | checkout | tracker | dietary | recommendation
  -> reply            streamed tokens, with the turn's outcome already in the prompt
```

Each specialist extracts structured intent first (a JSON-only call), resolves it
against the menu, and only then writes prose — so the sentence the customer
reads is written knowing what actually happened. The cart lives on the phone, so
the resolved operations travel back as `actions`: calls to the executors in
`src/goer/tools/executors.ts`.

**Checkout invariant:** no action can place an order. The strongest thing
Checkout can emit is `stage_order_confirmation`, which renders a card; only the
user tapping Confirm runs `placeOrder`.

### Data and training

`app/goer/data/` holds the agents' knowledge base. Regenerate after a menu edit:

```bash
python scripts/build_menu_dataset.py         # src/data/menu.ts -> data/menu.json
python scripts/build_transactions_dataset.py # synthetic Al Taib order history
python scripts/train_recommender.py          # -> data/trained/*.json (Apriori + popularity)
```

`build_menu_dataset.py` reads the app's `src/data/menu.ts` so item ids, names,
and prices have exactly one source of truth; it derives the allergens, diet
tags, and Arabic names the agents need. The retrieval index rebuilds itself on
every startup (upsert), so a menu change only needs a restart.
