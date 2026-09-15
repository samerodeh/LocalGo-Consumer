# Store listing copy — LocalGO Consumer

Paste-ready text for Play Console → **Grow users → Store presence → Main store listing**.

Written against what the app actually does today: two real Montréal partners, card checkout, live
driver tracking, and the in-app assistant. Nothing here promises a feature that isn't built —
overstating a listing is a Play policy violation in its own right, and it is the kind of thing a
reviewer checks by opening the app.

---

## App name (30 char max)

```
LocalGO
```

**Decide this once and make it match.** `expo.name` in `app.json` is currently `LocalGO` and your
Play listing header reads `LocalGo`. The launcher label and the store name should agree — pick one
casing and set both.

---

## Short description (80 char max)

Used in search results and the top of the listing. This one is 74 characters:

```
Montréal food delivery from Al Taib and Château Kabab, with live order tracking
```

Alternatives if you prefer a different angle:

```
Order Lebanese and Persian grills in Montréal. Track your driver in real time.
```

```
Downtown Montréal food delivery. Real menus, card checkout, live driver updates.
```

---

## Full description (4000 char max)

```
LocalGO delivers food from independent Montréal restaurants — no chains, no clutter, just the
neighbourhood places worth ordering from.

BROWSE REAL MENUS

Every item on LocalGO comes from the restaurant's actual menu, with real prices and real photos.
Right now we deliver from two downtown partners:

• Al Taib — Boulangerie & Grills on Guy Street. Manakish, pizza by the slice, grills, and bowls
  built from the counter.
• Château Kabab — Persian and Iraqi grill a block away. Kabab platters, shawarma, mezze, and
  saffron rice.

ORDER BY CHAT

LocalGO includes an assistant that can do everything the buttons can. Ask it what's vegetarian,
have it build your cart, set a tip, and start checkout — all in a conversation. It knows the menu,
so you can ask about ingredients or allergens before you order. It never places an order on its
own: nothing is charged until you tap Confirm on the summary it shows you.

DELIVERY THAT KNOWS WHERE IT'S GOING

Type your address with autocomplete or use your current location. LocalGO confirms every delivery
address against real coordinates before you can check out, so an order can't be placed to somewhere
a driver can't find.

TRACK YOUR ORDER

Once a driver accepts, you'll see it happen. Order status moves from placed to picked up to
delivered, and you can message your driver directly about buzzer codes, gate access, or where to
leave it.

PAY BY CARD

Checkout runs on Stripe. Your card details go straight to Stripe's payment sheet and are never
stored by LocalGO. Add a tip at checkout — it goes to your driver.

YOUR ACCOUNT, YOUR DATA

Order history stays on your device. You can delete your account and everything attached to it from
Settings, at any time, without emailing anyone.

We're starting small and local, with a short list of restaurants we actually deliver well from.
More are coming.
```

Roughly 1,700 characters — comfortably inside the 4,000 limit and short enough that people read it.

**One honesty note:** the "More are coming" line is a soft claim and fine. Do not add anything about
restaurant counts, delivery zones, or delivery times you can't meet. `deliveryTime` in the app says
20–30 minutes; the listing deliberately doesn't repeat that as a promise.

---

## App access (Play Console → App content → App access)

Reviewers cannot sign up against your Supabase project unaided, and checkout is gated behind a
verified delivery address. Without this they will reject the app for being untestable.

Select **All or some functionality is restricted**, add an instruction set:

**Name:** `Reviewer account`

**Username / Password:** a real account you have created in Supabase Auth for this purpose. Do not
use your personal account.

**Any other instructions:**

```
1. Sign in with the credentials above.
2. Tap the address bar at the top of the Home screen and enter a Montréal
   address — for example "2125 Guy St, Montreal". Pick a suggestion from the
   autocomplete list so the address resolves to coordinates. Checkout is
   blocked without a verified address; this is intentional.
3. Open Al Taib or Château Kabab from the Home screen and add any items.
4. Open the Cart tab and tap Place Order.
5. This build uses Stripe TEST mode. Pay with card number
   4242 4242 4242 4242, any future expiry date, any 3-digit CVC, and any
   postal code. No real money is charged.
6. The AI assistant is the floating button on the Home and Cart screens.
```

**Update step 5 before you ever ship a build with live Stripe keys.** If the build takes real
payments and this still says test mode, a reviewer will be charged for food that isn't coming.

---

## Graphics checklist

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, no transparency | `assets/icon.png` exists — check the size |
| Feature graphic | 1024×500 PNG/JPG | **missing** — required, listing won't publish without it |
| Phone screenshots | min 2, max 8, 16:9 or 9:16 | **missing** |
| 7" / 10" tablet | optional | skip |

**Screenshots to take** from the installed APK, in this order — they should tell the ordering story:

1. **Home** — both restaurants visible, so the app doesn't look empty
2. **Restaurant menu** — Al Taib, scrolled to show real food photos
3. **Cart** — a few items with the total broken down
4. **Goer chat** — mid-conversation, since it's the most distinctive thing here
5. **Order confirmed**

Avoid the Settings screen (nothing sells there) and anything showing a real address or email.

---

## Category and contact

- **App category:** Food & Drink
- **Tags:** Food Delivery, Restaurants
- **Contact email:** the one you'll actually monitor — it appears publicly on the listing
- **Website:** optional; the hosted privacy policy URL works if you have nothing else
- **Privacy policy:** required, same URL as the Data safety form
