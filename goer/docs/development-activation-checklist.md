# Development activation and acceptance checklist

Updated: 2026-11-06

## Goal and working agreement

Complete the existing LocalGo mobile development journey:

**Sign in → discover food → edit the shared server cart → restore saved history
→ explicitly confirm checkout → complete sandbox payment → persist one paid order.**

The user authorized continuing this plan through completion. Work through all
executable items, fix reproducible failures, and update this checklist with evidence.
Do not treat a blocker or a passing offline suite as completed acceptance. If a step
requires unavailable access or human interaction, record the exact dependency and
continue independent work. No repeated authorization is needed for the agreed
scope; production access and payment confirmation are not implied.

This checklist tracks execution, not a replacement architecture. Follow
[the operational runbook](cart-integration-runbook.md) and section 16 of
[the architecture plan](localgo-delivery-architecture-plan.md).

## Boundaries

- Use the existing development-only Supabase project and LocalGo mobile app.
- Do not activate production, create a shadow cart, or blindly reapply migrations.
- Preserve the durable Goer SQLite reasoning/command journal and stable request IDs.
- Keep credentials private and out of git, prompts and mobile bundles.
- Respect the private-file safety guard; do not retry blocked access via another tool.
- Payment requires the exact checkout confirmation and native Stripe flow. Never
  bypass PaymentSheet, bank authentication, owner/revision checks or recovery pins.
- Do not mark native acceptance complete based on a JavaScript export or test doubles.

## 1. Configure and restart development services

- [ ] Permit the required private configuration operations through the supported
  safety policy, or have the owner enter the settings manually. Do not paste secrets
  in chat. The previous private `.env` access attempt was blocked.
- [ ] LocalGo backend: set `SERVER_CART_ENABLED=true`; keep verified Supabase
  server credentials backend-only and Stripe in sandbox mode.
- [ ] Goer: set `LOCALGO_API_URL=http://127.0.0.1:8100` and
  `GOER_CART_ENABLED=true`; preserve the existing `GOER_CONVERSATION_DB` file.
- [ ] Mobile: set `EXPO_PUBLIC_API_URL` to the reachable backend on port 8100,
  `EXPO_PUBLIC_GOER_API_URL` to Goer on port 8000, and
  `EXPO_PUBLIC_SERVER_CART_ENABLED=true`.
- [ ] Recheck the current LAN address; bind services for trusted-LAN device access.
  Do not assume the previously observed `192.168.2.26` is still current.
- [ ] Restart backend, Goer and Metro; verify health, canonical catalog, invalid-token
  rejection, enabled authenticated cart access and native reachability.

## 2. Verify connected database security and retry safety

- [x] Read-only service-key validation succeeds (Auth admin HTTP 200).
- [x] Service-role `limit=0` reads succeed for all five expected cart/checkout/history
  tables; expected columns and four RPC names are exposed.
- [x] Public-key table reads are denied (HTTP 401 / PostgreSQL `42501`).
- [ ] Inspect actual migration state, SQL policies, grants and constraints using
  owner-provided SQL Editor/admin access. Schema exposure alone is insufficient.
- [ ] Obtain two designated development test sessions privately, or provision
  isolated test accounts once permitted access is available; track cleanup.
- [ ] Verify each account can access only its own cart, conversations and history;
  cross-account identifiers and direct unauthorized writes must fail.
- [ ] Verify first-write/concurrent-edit serialization, stale revision conflicts,
  immutable idempotent replay and same-key/different-command rejection.
- [ ] Verify history exact replay, changed-envelope rejection and account isolation.
- [ ] Remove any temporary test accounts/data and record cleanup evidence.

## 3. Exercise the real signed-in native journey

- [ ] Obtain a native development build and physical device or emulator. No Android
  SDK/device was available at the last check; stock Expo Go is insufficient for Stripe.
- [ ] Sign in, discover grounded catalog products and edit the shared cart through
  both chat and ordinary buttons; verify parity without duplicate writes.
- [ ] Restart/reinstall, open History, select an old conversation and start a new one.
  Preserve the Goer journal; cloud display history cannot reconstruct it.
- [ ] Interrupt history publication after a completed cart turn. Retry must publish
  the cached response without another cart mutation or model-planned command.
- [ ] Verify pending recovery across restart, account switching and A→B→A changes.

## 4. Verify explicit sandbox checkout and recovery

- [ ] Choose a verified delivery address and tip through chat; review the full CAD
  checkout summary without payment or separate Cart-screen navigation.
- [ ] Verify generic/wrong/stale confirmation and changed cart/address/tip cannot pay.
- [ ] With the user's exact `CONFIRM ORDER <code>`, complete the native Stripe
  sandbox PaymentSheet/bank flow as required.
- [ ] Verify paid amount/owner/order/revision binding, exactly one persisted paid
  order and exactly one consumption of the confirmed cart revision.
- [ ] Verify decline, cancel, processing, lost response, restart and account-switch
  recovery without replacement payments or unsafe cart unlocks.

## 5. Close acceptance

- [ ] Fix each reproduced failure in focused commits with regression coverage.
- [ ] Run the required offline suites and changed-tool smoke tests after code changes.
- [ ] Record connected/native results, dates, cleanup and remaining limitations here
  and in repository handoffs. Never store account identifiers, tokens or secrets.
- [ ] Mark the journey complete only when all required connected/native checks pass.
  Production remains separately gated, including retention/deletion, shared
  multi-host persistence and operational readiness.

## Evidence and blockers

Localhost browser acceptance (2026-11-06, Expo web build, Stripe test mode). The owner
reports these all passed; agent verification is noted where it exists:
- Sign-up returns to Sign In; sign-in, discovery cards, chat and button cart edits,
  history and account isolation work.
- Chat checkout: address via `deliver to` / `use address`, tip, full CAD summary,
  exact `CONFIRM ORDER <code>`; Stripe Payment Element opens for the server total.
- `4242…` succeeded. Agent read-only check: exactly one succeeded test-mode
  PaymentIntent ($13.26 CAD), one `orders` row with the same ID and PaymentIntent, and
  one `consumed` checkout for cart revision 3.
- Declined card (`4000…0002`) keeps the form open; Cancel leaves no order and the cart
  unchanged; 3-D Secure (`4000 0025 0000 3155`) completes; an old confirmation code
  after a cart change is refused.
- Card numbers typed into chat are refused before storage, tracing or the model.

Still open: native (EAS) build with the PaymentSheet on a device, restart/account-switch
recovery during payment, exact SQL policy/grant review, and all production gates.

Latest completed offline checks (2026-11-06): 127 Goer tests, 122 pinned backend
tests, 36 mobile/SQL cases with zero skips, and mobile TypeScript passed. SQL cases
use isolated PGlite, not connected concurrent Supabase sessions. The earlier Android
JS/assets export is not a native build or PaymentSheet test.

Last connected checks confirmed expected schema exposure and key validity, not
exact policies, function definitions, owner isolation or concurrency. Sibling
records report user-run migrations. Existing services responded on 8000/8100/8081;
cart remained feature-gated. No activation flags, accounts, schema or payments were
changed in that verification.

Fresh follow-up probes (2026-11-06): Goer health, backend health, canonical catalog
(145 products) and Metro return HTTP 200. Unsigned session returns 401 and cart
returns 503, confirming activation is still gated. ADB is absent from PATH and the
configured/common Android SDK locations. These checks did not read private files,
mutate state or exercise a native app.

Current dependencies: private configuration access/manual setup, designated test
sessions and SQL-admin inspection, plus native build/device and explicit checkout
interaction. Until these are available, connected and native acceptance stays open.
