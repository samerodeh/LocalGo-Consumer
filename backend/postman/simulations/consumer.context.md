# Consumer commerce simulation

Verified locally on November 12, 2026. The Postman member models only the Supabase HTTP operations used by this implementation, using fixture Auth identities and the real disposable PostgreSQL schema in `localgo_consumer_ux_test`. It is separate from the existing dispatch simulation and its database.

## Evidence

- 34 HTTP assertions passed through FastAPI → Postman → PostgreSQL: server pricing, promotion validation, checkout idempotency, customer ownership, courier publishing/staleness, purchase reviews, pickup progression and batched private order history.
- Separate SQL assertions exercised RLS, service-only RPC permissions, promotion rollback, pickup isolation from dispatch, courier ownership and review aggregates.
- Concurrent PostgreSQL calls verified a single redemption for a limited promotion and one receipt for simultaneous checkout retries.
- Browser UI verification used `customer@example.test` and simulated payments only. Pickup with a promotion and delivery with saved handoff instructions completed. The live tracking drawer displayed persisted fixture courier positions. Address pin adjustment, category jumps, phone/tablet layouts, and both themes were checked.

## Limits

Fixture tokens model identities; they do not test JWT cryptography, the complete PostgREST protocol or Supabase realtime. Courier positions were supplied through the local endpoint, not physical GPS. No live accounts, payments, hosted migrations, merchant approvals, promotion settings, or remote notifications were changed. Physical Android/iOS WebView, haptics, location and notification behavior remains unverified. Native JavaScript export is a build check, not a device runtime test.

## Run

See `docs/consumer-ux-architecture.md` at the repository root for bootstrap, environment isolation, CLI commands and scripts. The fixture SQL must never be used in a hosted database. The installed Postman CLI supports simulation; its `status` subcommand is unavailable, so simulation startup/request logs and actual HTTP responses provide the local verification evidence.
