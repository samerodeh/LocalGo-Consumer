# Consumer production readiness checklist

Updated: 2026-11-09. Work through these steps in order. A checked box needs connected or device evidence; local configuration and offline tests alone do not close a step.

## 1. Native payment acceptance

- [x] Build the existing `development` EAS Android APK. Build `052cf5c8-0776-4f7b-8f8c-a1e3604587b1` finished on 2026-11-09 from commit `e2f8899` after fixing Windows archive directory permissions.
- [ ] Install the APK on an Android device.
- [ ] Test signed-in discovery, chat and button cart parity, a verified address, explicit confirmation, native Stripe PaymentSheet, one paid order, and one cart consumption in test mode.
- [ ] Test declines, cancellation, stale confirmation, lost responses, app restart, and account switching without duplicate payment or order.
- [ ] Record results in the sibling Goer development activation checklist.

## 2. Connected database verification

- [x] Inspect the actual Supabase migration state, RLS policies, grants, and owner isolation. Verified 2026-11-09 against the connected project: migrations 0001-0003 present; RLS on for all five cart/Goer tables; `anon` has no grants; `authenticated` has only owner-filtered (`auth.uid()`) SELECT on `customer_carts`, `goer_conversations`, `goer_history_turns`; requests/checkouts are service-role only; cart RPCs are service-role only and `save_goer_history_turn` derives the owner from `auth.uid()`; all functions pin `search_path`.
- [ ] Verify concurrent cart behavior against the connected database (needs a direct DB connection; not yet run).
- [x] Check whether `202611080001_payment_refund_reconciliation.sql` has been applied; apply it only after reviewing the connected state. It was missing while the backend already called its RPCs; applied 2026-11-09 via the SQL Editor (2 existing checkouts, both `consumed`), and `refund_id` plus both refund RPCs are confirmed over the API.

## 3. Deploy and operate both services

- [ ] Deploy the LocalGo backend and the separate Goer service with production-appropriate availability and monitoring.
- [ ] Give Goer's conversation and command journal durable, backed-up storage; verify account deletion and set retention rules.
- [ ] Configure and alert on hourly payment reconciliation; validate the refund path in Stripe test mode.

## 4. Configure production environments

- [ ] Set the four required public HTTPS variables in the linked Expo project's production EAS environment; keep secrets server-side.
- [ ] Configure the deployed LocalGo and Goer services, including cart flags, Stripe keys, and the webhook signing secret.
- [ ] Check the deployed health endpoints and intended Stripe mode before live traffic.

## 5. Close business and privacy decisions

- [ ] Review the no-tax pricing policy, data retention, Goer backups/deletion, and public delivery-photo URLs.
- [ ] Ensure the hosted privacy policy and store listing accurately describe the released behavior and payment mode.

## 6. Prepare the Google Play release

- [ ] Create the feature graphic, screenshots, reviewer account, privacy/Data safety declarations, and signing/submission setup.
- [ ] Build a production AAB, test through Play's internal track, and meet any account-specific closed-testing requirements before promotion.

Do not treat a development APK, a web checkout, or an offline test suite as production acceptance.
