# Play Console setup — answers for LocalGO Consumer

Every "Finish setting up your app" task, with the answer for **this** app derived from the code
rather than guessed. Work top to bottom; closed testing stays locked until these are done.

**The sequence is forced:**

```
Finish setting up your app  →  Closed test unlocks  →  12 testers × 14 continuous days
                            →  Apply for production access  →  Production
```

The 14 days are wall-clock and cannot be compressed. Start the closed test the moment it unlocks,
even if you are still polishing — everything else can be fixed while that clock runs.

---

## Account deletion — built

Google requires apps with sign-up to offer an in-app deletion path *and* a public URL describing
it. Both now exist.

**In-app:** Settings → **Delete Account**, with a destructive confirmation. Immediate, no waiting
period. **URL:** section 9 of the privacy policy documents the process — submit that same URL as
the deletion URL in the Data safety form.

The rule is *erase the person, keep the transaction*:

| Store | What happens |
|---|---|
| `orders` | kept as business records; `customer_id` nulled, name and dropoff address redacted |
| `messages` | the customer's own messages deleted (no FK, so nothing cascaded them) |
| `customers` | deleted by cascade from `auth.users` |
| `push_tokens` | deleted by cascade from `auth.users` |
| `auth.users` | deleted last, via the Auth admin API |
| AsyncStorage | orders, addresses, saved cards, chat history, session — all cleared |

Delivery photos stay attached to the anonymized order rather than being deleted, and a copy sits in
whatever inbox the receipt reached. The policy says so; don't claim a clean wipe you don't perform.

Orders are retained deliberately: CRA wants business records ~6 years, and both PIPEDA and Law 25
permit retention for legal and accounting obligations as long as you disclose it. The policy
discloses it.

**Security note:** the endpoint verifies the caller against Supabase Auth rather than decoding the
JWT locally. `postgrest.jwt_sub` does not check signatures — using it here would have let a forged
token delete anyone's account.

---

## 1. Privacy policy

Needs a public URL. The drafted policy is `privacy-policy.html` in this repo — a complete,
self-contained page ready to host as-is.

Host it somewhere stable — GitHub Pages off your existing account is free and fine. Then paste the
URL in **Policy → App content → Privacy policy**, and link it from the Settings screen too.

## 2. App access

Reviewers cannot sign up against your Supabase project on their own, and checkout is gated behind
a verified delivery address — a reviewer who can't get past that will reject the app.

Provide, under **All functionality is not publicly available**:

- A real test account (email + password) that already exists in Supabase.
- Instructions: sign in → add a delivery address (autocomplete needs a real Montreal address) →
  add items from **Al Taib** (the only partner with a live menu) → checkout.
- A Stripe **test** card number if the build points at test keys, or note that checkout takes a
  real payment if it points at live keys.

## 3. Ads

**No**, the app contains no ads. Nothing in the codebase serves any.

## 4. Content ratings

Complete the questionnaire. This app is a food-delivery marketplace: no violence, no sexual
content, no gambling, no user-generated content shared between users. Expect **Everyone / PEGI 3**.

One question needs care: it asks whether users can interact or share content. Goer is an AI
chatbot, not user-to-user messaging, and the driver↔customer chat is one-to-one within an order.
Answer honestly rather than reflexively "no".

## 5. Target audience and content

- Target age: **18+**. Do not select any under-13 bracket — the app takes payments and collects
  precise location, and a child-inclusive audience triggers Families policy requirements you do
  not want.
- Appeals to children: **No**.

## 6. Data safety

The most exacting form, and the one that must match reality or the listing gets pulled later.
Declare **encrypted in transit: yes** (everything is HTTPS), **deletion available: yes**, and give
the hosted privacy-policy URL as the deletion URL.

| Data type | Collected | Shared | Linked to user | Purpose | Where in the code |
|---|---|---|---|---|---|
| Name | Yes | No | Yes | App functionality, Account management | signup → `customers` |
| Email address | Yes | No | Yes | App functionality, Account management | Supabase Auth |
| Precise location | Yes | **Yes** | Yes | App functionality | `src/lib/geocoding.ts` → Photon |
| Approximate location | Yes | **Yes** | Yes | App functionality | same |
| Address | Yes | **Yes** | Yes | App functionality | dropoff sent to driver + Photon |
| Purchase history | Yes | No | Yes | App functionality | `orders` table |
| Other in-app messages | Yes | **Yes** | Yes | App functionality | Goer chat → Groq |
| Device or other IDs | Yes | No | Yes | App functionality | Expo push token → `push_tokens` |
| **Photos** | Yes | **Yes** | Yes | App functionality | driver pickup/drop-off photo → `order-photos` |

**Why three rows say "shared":** Google counts a transfer to a third party as sharing.

- **Photon** (`photon.komoot.io`, Komoot) receives every address the user types and their GPS
  coordinates for reverse geocoding. It is a third-party service, not your infrastructure.
- **Groq** receives Goer chat messages along with the live cart and delivery address, which are
  rebuilt into every system prompt.
- Drivers receive the customer's name and dropoff address — arguably app functionality rather than
  sharing, but be ready to justify it.
- **Your email provider** (whatever `SMTP_*` points at) receives the customer's email address, the
  order summary, and the pickup photo, for the receipt in `backend/app/mailer.py`.

**Photos — new, and the row people get wrong.** The driver's pickup photo is collected *by the
driver about the customer's order*, and it is still the customer's data. Declare it under
**Photos and videos → Photos**, collected and shared (it leaves for the email provider).

Also be ready to answer honestly about how it's stored: the `order-photos` Supabase bucket is
`public = true` with an open `select` policy, so the photo is readable by anyone holding the URL.
The keys are unguessable UUIDs, which is why this is defensible, but it is **not** access-controlled
and you should not describe it as such. Section 2 of the privacy policy now says this plainly.

If that trade-off stops being acceptable — a doorstep photo is more sensitive than a bag on a
counter — the fix is a private bucket plus signed URLs with an expiry, and the email attaching the
image inline (which `mailer.py` already does) rather than linking it.

**Payment info — judgment call.** Card details go through Stripe's PaymentSheet UI and never touch
your servers or your code. Google's guidance says data collected directly by a payment processor
in its own interface, which you never receive, need not be declared. I would **not** declare
"Payment info" as collected, but this is the one row I'd double-check against Google's current
wording rather than take my word for.

## 7. The remaining declarations

Financial features: **No** (delivery of food, not a financial product). News app: **No**.
COVID-19 contact tracing: **No**. Government app: **No**. Health: **No**.

## 8. Store listing

- **App name:** decide `LocalGO` vs `LocalGo` and make `expo.name` in `app.json` match.
- **Short description** (80 chars) and **full description** (4000).
- **App icon** 512×512 PNG.
- **Feature graphic** 1024×500 — required, and none exists in `assets/`.
- **Phone screenshots**, minimum 2. Grab these from the dev build: home, restaurant menu, cart,
  order confirmed.
- **Category:** Food & Drink. Contact email and, once hosted, the privacy policy URL.

---

## Before you upload the first build

- [ ] Stripe keys into the **Render** dashboard, not just `backend/.env` — the deployed backend is
      still in demo mode and takes no money.
- [ ] Register the Stripe webhook endpoint and set `STRIPE_WEBHOOK_SECRET`.
- [ ] Device test the PaymentSheet (`npx expo run:android`) — the app half has never run.
- [ ] Build the AAB: `npx eas build --platform android --profile production`
- [ ] Bump `android.versionCode` before every subsequent upload.
- [ ] Move the backend off Render free tier, or a tester's first order hits a cold start.

## Known rough edges a tester will hit

- Only **Al Taib** has a real menu; every other partner renders "coming soon". A store full of
  dead restaurants reads as unfinished.
- The Settings → **Notifications** row is inert (no `onPress`). It renders without a chevron and is
  disabled, so it is not as bad as a fake button, but it still goes nowhere.
- No profile editing — Settings only displays name and email.
