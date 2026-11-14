# LocalGO Consumer experience

## Design and scope

Food-led discovery inspired by DoorDash/Uber Eats: prominent neighbourhood context, category stories, merchant rails, compact delivery metadata, sticky menu tabs, item drawers, a micro-cart, and explicit checkout. LocalGO retains orange/navy/Barlow with warm cream surfaces and butter-coloured editorial panels. Expo SDK 54 remains pinned. Native React Native components, Expo Image, Expo Haptics and platform-specific Leaflet maps avoid replacing the working app framework.

## Screen and component ownership

- Home owns address-sheet visibility, search and catalogue discovery; saved-address persistence remains in addressStore.
- `components/ui`: Badge, BottomSheet, QuantityStepper and Skeleton.
- `components/discovery`: category stories, merchant cards and rails. Only real merchants are listed; unavailable categories say Coming soon.
- `components/address`: saved-location drawer; Address route owns geocoding, pin adjustment and validation.
- `components/merchant`: sticky category navigation. ItemOptionsSheet preserves required options, notes and quantities.
- `components/cart`: MicroCart and checkout controls. Monetary quotes and promotion eligibility come from the server.
- `components/tracking`: delivery progress and authenticated location polling. Courier coordinates are never simulated or inferred from delivery stages.
- `components/maps`: native WebView and web Leaflet implementations with shared typed point/pin contracts.

## Consumer API contract

All protected endpoints verify Supabase sessions. Authentication and ownership errors fail closed. `GET /consumer/catalog` exposes merchant metadata; missing review data stays null. `POST /consumer/quote` validates merchant/item IDs, option requirements, prices, fulfillment, tips and promotions in integer cents. `POST /consumer/checkout` recomputes the quote, checks the accepted total, and atomically creates an idempotent receipt and consumes a promotion through a service-only RPC. Delivery receipts bridge into existing dispatch; pickup receipts never enter the driver feed. Payments remain development-only until a verified payment integration exists.

`GET /consumer/orders` and `GET /consumer/orders/{id}` return only the caller's orders. `POST /consumer/merchant/orders/{id}/status` authorizes merchant staff and enforces pickup transitions. `POST /consumer/orders/{id}/review` accepts one customer review only after fulfillment. `POST /consumer/orders/{id}/location` accepts updates only from the assigned approved driver while delivery is active. Location polling reports stale timestamps explicitly.

## Deployment and data

Apply `backend/migrations/20261111_consumer_experience.sql` after the existing driver schema/migrations. The backend needs its existing Supabase service-role secret for atomic checkout and location writes; never expose it in EXPO_PUBLIC values. Merchants must explicitly enable pickup, provision staff membership, maintain catalog metadata and configure promotions. No fabricated ratings, badges, promotions or merchant approval claims are seeded. The sibling driver app now publishes consented foreground fixes for its active delivery (`src/store/useDriverLocation.ts`, wired from `app/index.tsx`). Location sharing stops when there is no active order; it does not request permission automatically. Updates are polled every 10 seconds by the consumer, and positions older than 90 seconds are marked paused. Background GPS is not implemented. Merchant coordinates remain nullable until verified coordinates are entered; distance labels and store pins are omitted when unknown. Native map/haptic dependencies require a new development/EAS build; Expo Go supports the SDK-compatible modules.

## Verification

Exercise quote integrity, promotion expiry/caps/concurrency, checkout idempotency, cross-customer access, driver ownership/stale positions, pickup status transitions, review eligibility and legacy delivery regressions. Verify 375px and tablet widths, keyboard and screen-reader controls, both themes, reduced motion, disabled/loading states, address validation and cart arithmetic. Local tests are distinct from live migration, merchant provisioning, and physical-device verification.


## Launch boundaries

- This work is local and uncommitted. No hosted database, deployed backend, merchant approvals or live promotion settings were changed.
- Existing release-mode checkout protection remains: payment is simulated only in explicitly enabled development mode. A production payment integration is outside this UI/commerce change.
- The current real catalogue contains two restaurant merchants. Other categories appear as coming soon until real merchants and menu products are provisioned. Merchant menu options in the restored source are currently empty; the item sheet and authoritative option validator support real option groups without inventing dietary or add-on data.
- Pickup must be explicitly enabled per merchant, and staff memberships must be provisioned before staff can advance pickup orders. Promotions are inactive unless an administrator configures them. Ratings are calculated from one review per completed purchase.
- The migration creates new private tables and service-only atomic RPCs. Run it after the existing driver schema, `20261111_single_driver.sql`, and `20261111_courier_workflow.sql`. Do not re-run the older base schema after migrations.
- Native map and haptic modules are Expo SDK 54 compatible. Physical-device location, haptics, notifications and WebView behavior still require Android/iOS runtime verification.

## Reproduce local verification

The disposable PostgreSQL database is `localgo_consumer_ux_test` on `127.0.0.1:55439`. Bootstrap it with the sibling driver test database bootstrap, base schema and driver migrations, create the local `service_role` with BYPASSRLS to model Supabase, then apply the consumer migration. Never run `tests/database/consumer_fixture.sql` on a hosted database.

Run the SQL assertions with `psql -v ON_ERROR_STOP=1 -f backend/tests/database/consumer_experience.sql` against that disposable database. They roll back their fixtures. The HTTP fixture setup is `backend/tests/database/consumer_fixture.sql`.

Start the Postman service from `backend/`:

```sh
postman simulation run postman/simulations/consumer.sim.yaml --port 4911 --no-history --output ndjson
```

Start FastAPI with only fixture services (the values below are local test identities, never production credentials):

```sh
SUPABASE_URL=http://127.0.0.1:4911/supabase SUPABASE_ANON_KEY=simulation-publishable \
SUPABASE_SERVICE_ROLE_KEY=simulation-service APP_ENV=development ALLOW_DEMO_ORDERS=true \
CORS_ORIGINS=http://localhost:8086 .venv/bin/python -m uvicorn app.main:app --port 18084
```

Run `.venv/bin/python scripts/check_consumer_experience.py` from `backend/`. It targets localhost only and verifies real HTTP plus actual PostgreSQL constraints. The stand-in models Auth identities and the used PostgREST subset; it does not verify JWT signatures or the full managed Supabase service.

For the browser, start Expo with `LOCALGO_VERIFY=1 EXPO_NO_DOTENV=1`, `EXPO_PUBLIC_API_URL=http://127.0.0.1:18084`, `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:4911/supabase`, and `EXPO_PUBLIC_SUPABASE_ANON_KEY=simulation-publishable`. Use port 8086. Fixture login is `customer@example.test` / `simulation-only`. These values must never enter EAS/release environments.

### Completed checks (November 12, 2026)

- 30 consumer frontend tests and 53 backend tests passed; consumer TypeScript passed.
- 25 sibling driver tests and driver TypeScript passed after foreground-sharing integration.
- 34 HTTP assertions passed against the new Postman simulation and actual disposable PostgreSQL.
- SQL assertions and separate concurrent RPC tests passed, including one-redemption caps and duplicate-checkout idempotency.
- Browser verified pickup + promotion checkout, delivery + handoff instructions, tracking-map presentation, saved manual map pin, sticky category jumps, and light/dark layouts at phone and tablet widths.
- Android JavaScript export passed. Physical-device behavior and production deployment remain unverified.

The source API contract is exported in `backend/contracts/consumer.openapi.json`. Simulation assumptions and boundaries are in `backend/postman/simulations/consumer.context.md`.
