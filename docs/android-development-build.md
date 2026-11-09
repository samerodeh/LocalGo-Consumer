# Android development build (not native acceptance)

The `development` EAS profile builds an internal APK with the installed development
client. It does not use preview/production profile endpoints. No build, upload,
credential generation or production activation is authorized by this document.
Keep Expo SDK 54 and the existing EAS project/package linkage unchanged.

On this Windows OneDrive checkout, the normal EAS archive path copied directory
mode `444` into the Linux build tarball and failed in **Prepare project**. The
`cli.requireCommit` setting makes EAS prepare a shallow Git clone instead. Commit
the intended source changes before building; ignored private `.env` files remain
outside that clone and the `.easignore` exclusions still apply.

## Owner prerequisites

1. Sign in to Expo and confirm access to the existing project in `app.json`
   (`samerodeh/LocalGOConsumerRN`). Do not create/relink a replacement project.
2. In that project's **development** EAS environment, configure these public values:
   - `EXPO_PUBLIC_API_URL`: device-reachable development LocalGo backend (8100 locally).
   - `EXPO_PUBLIC_GOER_API_URL`: device-reachable development Goer (8000 locally).
   - `EXPO_PUBLIC_SUPABASE_URL`: development-only Supabase project URL.
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY`: that project's public/publishable key only.
   The profile sets `EXPO_PUBLIC_SERVER_CART_ENABLED=true`. Backend development
   flags must already be deliberately enabled. No service-role, model, database or
   Stripe secret belongs in EAS/client variables. Backend Stripe must stay test-mode.
3. Provide an Android device and choose/approve the project's Android signing
   credentials. Cloud compilation needs no local Android SDK; installation and
   runtime acceptance still need a device. Stock Expo Go cannot run PaymentSheet.
4. Localhost on a phone means the phone, not this computer. For local development,
   use reachable LAN addresses, bind both servers appropriately and restrict
   firewall access to the development network. Prefer HTTPS development endpoints.

## Commands (owner runs after prerequisites)

```powershell
npx eas-cli whoami
npx eas-cli project:info
# Inspect the archive locally first; do not upload private environment files.
npx eas-cli build:inspect --platform android --profile development --stage archive --output ../localgo-eas-inspect
# After confirming the development environment and archive:
npx eas-cli build --platform android --profile development
```

`.easignore` excludes root/nested private environment files and the backend.
Do not print private files while reviewing the archive. Install the generated APK.
For LAN development, start Metro with the same four public development variables
set privately in the process and run `npx expo start --dev-client --lan`.
Metro supplies the bundle's public values; EAS configuration alone does not set
variables in a later local Metro process. Do not put private values in commands
saved to source control or chat. Use a tunnel only after reviewing access scope.

## Required device evidence

Use designated development test accounts. Verify sign-in, discovery, shared cart,
history, plain-sentence address search plus explicit choice, summary and the exact
`CONFIRM ORDER <code>`. Stripe's secure PaymentSheet/bank challenge must complete
before one paid order/one cart consumption is claimed. Verify decline, cancel,
stale summary, restart during pending work, account switching and A→B→A recovery
without a replacement payment or cross-account disclosure. Record dated results
in the Goer development activation checklist without identifiers or secrets.

Current status: profile/instructions prepared only. No EAS upload/build, installed
APK or native PaymentSheet acceptance has been performed. The owner must supply
Expo access, reachable development endpoints and a device. Separately, return the
read-only development `supabase/checks/verify_cart_security.sql` results for policy,
grant and RPC review; do not blindly reapply migrations.
