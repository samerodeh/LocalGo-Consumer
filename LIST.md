# LocalGO — Road to Publishable

Working list to get **LocalGO Consumer** (`com.samerodeh.localgoconsumer`) shipped on Google Play,
fully functional and tested. Driver app (`com.samerodeh.localgodriver`) tracked at the bottom.

Status as of **2026-08-31**. Play listing exists; app is at the "Get ready to publish" stage.

> **Hard deadline:** unregistered packages are pulled from Play on **2026-09-30** and stop
> installing on certified devices. Consumer is Registered (3 keys). Driver is **Draft, 0 keys**.

---

## P0 — Blockers. Cannot ship without these.

### 1. Checkout takes no money — **built, needs keys + a device test**

- [x] Replaced the simulated payment in `src/lib/placeOrder.ts`.
- [x] Stripe PaymentSheet wired (`src/lib/payments.ts`, `@stripe/stripe-react-native` 0.50.3).
- [x] `POST /payments/intent` creates the PaymentIntent; secret key stays server-side.
- [x] Backend reprices from its own menu (`backend/app/pricing.py`) — client totals are ignored.
- [x] `POST /orders` refuses (402) without a succeeded intent whose metadata matches the order id.
- [x] Decline, cancel, and network-failure paths all handled distinctly.
- [x] Order is recorded only after the charge succeeds.
- [x] Test keys in `backend/.env` (gitignored). Verified end-to-end against Stripe's real test
      API: intent created for the server-computed amount, paid with `pm_card_visa`, gate accepted
      it, declined card and cross-order replay both rejected.
- [ ] **Add the same keys to the Render dashboard env** — `backend/.env` is local only, so the
      deployed backend still has `STRIPE_CONFIGURED = False` and silently runs in demo mode.
- [ ] **Run a real card through the PaymentSheet UI on a device.** The backend half is proven; the
      app half (`initPaymentSheet`/`presentPaymentSheet`) has never actually run — it needs a dev
      build, since Stripe is a native module and Expo Go can't load it.
- [x] Webhook built: signature verified, orphaned charges detected and logged as
      `ORPHANED CHARGE` (`POST /payments/webhook`). Tested with real Stripe-signed payloads —
      forged and missing signatures both rejected 400.
- [ ] **Register the endpoint in Stripe** (Developers → Webhooks → Add endpoint,
      `https://<backend>/payments/webhook`, events `payment_intent.succeeded` +
      `payment_intent.payment_failed`) and put its `whsec_…` in `STRIPE_WEBHOOK_SECRET`. Until
      then the endpoint returns 503.
- [x] Added a read-only audit of succeeded Stripe events older than 15 minutes:
      `python -m app.payment_reconciliation` from `backend/`. It checks the last 48 hours
      against service-role order reads, reports missing/unknown orders without card data,
      and exits nonzero for operator attention. Offline tests cover duplicate events and lookup failure.
- [ ] Schedule the audit more often than its 48-hour window and alert on nonzero exit.
      The webhook alone can flag a false orphan before `POST /orders` completes.
- [ ] Choose and implement the final response to confirmed paid-without-order cases
      (manual recovery or an idempotent refund after a review window).
- [ ] Decide on sales tax. Nothing charges GST/QST today; see the PRICING NOTE in `pricing.py`.

### 2. Dead auth buttons — **done**

- [x] Removed the Apple/Google buttons, the "or" divider they sat under, the `SocialButton`
      component, and its seven orphaned styles from `app/(auth)/login.tsx`. Typecheck clean.
      Email/password was and remains the only sign-in path. To add real OAuth later, wire
      `supabase.auth.signInWithOAuth` — the buttons were never connected to anything, so nothing
      was lost by deleting them.

### 3. Privacy policy — **drafted**

- [x] Written as `privacy-policy.html` (standalone, hostable). Covers every real data flow read out
      of the code: name, email, address, precise/approximate location, order history, push token,
      assistant messages, and the six third parties that receive them.
- [ ] Fill in the three placeholders: legal name and a monitored contact email (marked in the page).
- [ ] Host it and paste the URL into **Policy → App content → Privacy policy**.
- [ ] Link it from the Settings screen.
- [ ] Have someone qualified review it — Québec Law 25 applies and I am not a lawyer.

### 4. Account deletion — **done**

- [x] `DELETE /account` (`backend/app/routers/account.py`): scrubs orders, deletes the customer's
      messages, closes the Supabase account (cascading `customers` + `push_tokens`).
- [x] Caller verified against Supabase Auth, not by decoding the JWT locally — `jwt_sub` doesn't
      check signatures, so using it would have let a forged token delete anyone's account. Tested.
- [x] Settings → **Delete Account** with a destructive confirmation; local AsyncStorage wiped
      (orders, addresses, cards, chat, session) via `clearUserData`.
- [x] Privacy policy §7 and §9 updated to describe the real behaviour.
- [ ] Exercise it once on a device against a throwaway account before shipping. The auth gates are
      tested; the full happy path has only run against a stubbed Supabase.

See `PLAY-SETUP.md` for the full task-by-task Play Console answer sheet.

---

## P1 — Play Console requirements

- [ ] **Data safety form.** Declare location (`ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION`,
      `app.json:23-26`), email, push tokens, order history. Must match what the app actually does,
      or the listing gets rejected later.
- [ ] **Store listing.** Short + full description, feature graphic (1024x500), phone screenshots
      (min 2), app icon (512x512). Only `assets/icon.png` exists today.
- [ ] **Content rating questionnaire.**
- [ ] **Target audience & content declarations.**
- [ ] **Ads declaration** (no ads → declare it).
- [ ] **App access.** Reviewers cannot sign up for a real account against your Supabase project
      unless you give them credentials. Provide a demo login in the App access section.
- [ ] **Closed test: 12 testers, 14 continuous days**, if this is a personal developer account.
      This is a wall-clock requirement — start it early. It gates production access regardless of
      how finished the code is.

---

## P2 — Testing. Currently zero.

There is no test infrastructure in this repo: no test script in `package.json`, no test files, no
typecheck or lint script, and no backend tests under `backend/`.

### Set up

- [ ] Add scripts: `"typecheck": "tsc --noEmit"`, `"lint": "expo lint"`, `"test": "jest"`.
- [ ] Install `jest-expo` + `@testing-library/react-native`.
- [ ] Add `pytest` to the backend.

### Cover the logic that can lose money or break orders

- [ ] **Money math** — `ordersStore` stores cents to avoid float drift. Test totals, tip, and tax
      arithmetic. Regressions here are silent and expensive.
- [ ] **Delivery-location gate** — `src/lib/deliveryLocation.ts` is enforced in four places (Cart,
      `placeOrder()`, `goerStore.stageOrder()`, backend `POST /orders`). Test each, including the
      `(0,0)` "never geocoded" sentinel.
- [ ] **Checkout safety invariant** — no Goer action can place an order; only the confirmation
      card's Confirm button can. Test the staged→placing guard and the stale cart-hash check.
- [ ] **Payment** — once #1 lands: success, decline, cancel, timeout.
- [ ] **Auth modes** — Supabase-configured and demo-mode both produce the same `StoredUser` shape.
- [ ] **Backend** — `POST /orders` (incl. the 422 location rejection), the driver feed, and the
      atomic claim with its 409 lost-race path.

### Manual pass before submitting

- [ ] Full order on a **physical Android device from the production AAB** — not Expo Go. Native
      permission prompts and push behave differently in a release build.
- [ ] End-to-end with the driver app: order → driver feed → accept → picked up → delivered.
- [ ] Cold start against the deployed backend (see P3 — Render free tier sleeps).
- [ ] Location denied, and location granted-then-revoked.
- [ ] Offline: Goer should fall back to local NLU; checkout should fail cleanly, not hang.

---

## P3 — Release mechanics

- [x] `production` profile in `eas.json` — `distribution: store`, `buildType: app-bundle`.
- [x] `env` block carried into the production profile. **Do not remove it.** `.env.local` is
      gitignored and never reaches the cloud build; without this, dispatch silently breaks. The
      tell in the build log is `No environment variables ... found`.
- [x] `android.versionCode: 1` added to `app.json`.
- [x] `expo.name` fixed: `LocalGOConsumerRN` → `LocalGO` (this is the launcher label users see).
- [ ] Decide whether the launcher label should be `LocalGO` or `LocalGo`, to match the Play listing.
- [ ] Bump `versionCode` before every upload — `appVersionSource` is `local`, so it does not
      auto-increment and Play rejects a repeat.
- [ ] Commit the 24 uncommitted files (incl. untracked `backend/app/goer/`) so the build is
      reproducible and you know what shipped.
- [ ] **Move the backend off Render free tier.** `localgo-backend-kjfz.onrender.com` spins down
      when idle; a reviewer's first order eats a cold start and may look like a hang.
- [ ] Verify the production AAB installs and runs before uploading:
      `npx eas build --platform android --profile production`

---

## P4 — Worth doing, not blocking

- [ ] Delete `supabase/functions/goer-chat/` — dead since two rewrites ago (noted in CLAUDE.md).
- [ ] No profile-editing UI; Settings only shows name/email + sign-out.
- [ ] Only **Al Taib** has a real menu. Every other partner renders "coming soon" — decide whether
      to ship them at all, since a store full of dead restaurants reads as an unfinished app.
- [ ] Address entry has no map picker (autocomplete + GPS only).
- [ ] Add crash reporting (Sentry) before you have real users.

---

## Driver app — `com.samerodeh.localgodriver`

Repo: `../LocalGo-driver`. Separate Play listing, separate EAS project
(`7a595c52-6c65-4593-bd7f-46a9579a7d05`), its own keystore.

- [ ] Verification row is **Draft with 0 keys**. It should resolve once the app is created in Play
      and an AAB is uploaded; add the SHA-256 fingerprint manually only if it is still Draft then.
- [ ] Create the Play listing (Play Console → All apps → Create app).
- [ ] `eas.json` has only a `preview` profile building APKs — needs a `production` / `app-bundle`
      profile, same as consumer.
- [ ] `app.json` has no `android.versionCode`.
- [ ] `app.json` has **no `ios.bundleIdentifier`** — EAS will invent one at build time. Pin it to
      `com.samerodeh.localgodriver`.
- [ ] `expo-image-picker` declares camera + photo permissions, but the package is never imported
      anywhere in `app/` or `src/`. Either wire up the pickup/drop-off proof photos or drop the
      plugin — otherwise drivers are asked for camera access that is never used.
- [ ] Same P1 Play requirements apply: privacy policy, data safety, listing assets, content rating.
