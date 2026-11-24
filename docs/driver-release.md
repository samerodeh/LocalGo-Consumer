# LocalGO Driver release

Prepared against production-source commit `54fbd0837482076d75f65f9eec49417374f2b2a4`. Do not deploy the older driver-development backend at `15280e5`: it lacks the production payment, refund, account-deletion and server-cart modules.

## Result and validation

This patch preserves those modules and adds approved driver access, online shifts, expiring offers, atomic claims, pickup checks, uploaded order-owned proof, atomic progress, and recorded activity. Verified customers reach the existing payment gate before backend service-role dispatch insertion. Legacy payments without a verified tip retain unknown driver pay. Account deletion clears the new coordinates, instructions and entry code.

Status and overlay commit together. Failed writes do not report success. Retries preserve timestamps and do not send duplicate notifications. Clients cannot directly insert unpaid orders or write status/overlays.

148 backend tests, 30 HTTP integration checks and PostgreSQL 16 authorization/workflow/atomicity checks passed locally. The HTTP run used actual FastAPI and database policies/RPCs with a Postman Supabase protocol stand-in. It did not establish real JWT, storage delivery, remote push, real payments, or Android device behavior. The local verification performed no production migration, approval or payment. GitHub publishing and live rollout are tracked separately.

## Deployment order

1. Apply this patch on a release branch based on the production source above. The user authorized GitHub publishing for this deployment on November 24, 2026. Publish the release branch for CI and deploy its verified commit through Render. Existing local uncommitted work was preserved in the original checkout.
2. Confirm a recoverable database backup and the existing backend-only service key. No new key is required.
3. Apply `supabase/migrations/20261111_single_driver.sql`, then `20261111_courier_workflow.sql`. These prepare schema/RPCs without approving anyone. Legacy anonymous order insertion stays available while the old backend is being replaced.
4. Deploy the compatible published commit in Render service `localgo-backend-md2s`, root `backend`, using its existing build/start settings. Verify health and existing payment/account routes plus the new driver routes.
5. Apply `supabase/migrations/202611230001_atomic_driver_progress.sql`. It activates guarded progress and removes direct order insertion/status/overlay writes. The old backend cannot use this contract: do not roll back to it after activation. Keep the compatible backend and disable the testing release if acceptance fails.
6. Create the requested Auth account privately. Approve only that exact existing account after identity confirmation. Never derive approval from user metadata or approve a second account. Reviewer access must not expose production customer data.
7. Verify a designated delivery on Android: tracking, checklist, uploaded proof, retry, chat, camera, location, navigation, and push. Any checkout acceptance must use Stripe test mode rather than a real charge.
8. Complete driver-specific privacy/data disclosures and the in-app policy link, reviewer access, ratings/audience and listing assets before publishing a test. Internal testing does not satisfy Google's separate closed-test production gate.

## Local checks

Run `python -m pytest backend/tests -q` with pinned test dependencies.

Database fixtures under `backend/tests/database/` are for a fresh disposable local database only. Run driver_bootstrap, driver_base_schema, the first two migrations, driver_workflow, activation migration, and driver_progress in that order. Never run the bootstrap/base fixtures against Supabase.

The Postman simulation is `backend/postman/simulations/dispatch.sim.yaml`. Its adapter defaults to PostgreSQL `127.0.0.1:55440`, database `localgo_release_http`; override LOCALGO_TEST_PORT/LOCALGO_TEST_DATABASE for another disposable fixture. The HTTP fixture additionally needs storage name/owner_id/metadata fields and a service_role with BYPASSRLS/table access modelling the real server role.

Start the simulation on 4910 and FastAPI on `127.0.0.1:18083`. Fixture configuration: Supabase URL `http://127.0.0.1:4910/supabase`, anon key `simulation-publishable`, service key `simulation-service`, server-cart disabled, Stripe/Groq keys empty. Run `DISPATCH_TEST_API=http://127.0.0.1:18083 python backend/scripts/check_dispatch_simulation.py`. No production credentials are needed.

## Release state

The Android bundle is uploaded as an unpublished internal-testing draft with two internal tester accounts. Production backend/database activation and driver-account creation/approval remain pending. Google production access needs a separate closed test with at least 12 opted-in testers for 14 continuous days. Privacy, reviewer credentials and listing assets remain incomplete. Five high client dependency advisories remain within SDK 54 after compatible fixes removed the critical advisory; compatibility/exposure still needs resolution before production.
