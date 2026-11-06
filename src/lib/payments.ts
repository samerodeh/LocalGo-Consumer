// Stripe PaymentSheet — the real charge that replaced checkout's simulated
// `setTimeout`. Deliberately a plain module rather than a hook: both entry
// points to checkout (the Cart screen and Goer's in-chat confirmation card) go
// through `placeOrder`, which is called outside React, and
// initPaymentSheet/presentPaymentSheet are module-level functions.
//
// The web build resolves payments.web.ts instead (Stripe.js Payment Element);
// both share the backend quote logic in paymentIntent.ts.
//
// The publishable key comes from the intent response rather than from a
// bundled env var, so there is exactly one place a Stripe key is configured
// (the backend) and the two can never drift apart.
import {
  initPaymentSheet,
  initStripe,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import {
  createPaymentIntent,
  precheckQuote,
  type PaymentInput,
  type PaymentQuote,
  type PayOutcome,
} from './paymentIntent';

export { createPaymentIntent, isPaymentsConfigured } from './paymentIntent';
export type { PaymentQuote, PayOutcome } from './paymentIntent';

let stripeReadyFor: string | null = null;

/** initStripe is idempotent but not free; only re-run it if the key changes. */
async function ensureStripe(publishableKey: string): Promise<void> {
  if (stripeReadyFor === publishableKey) return;
  await initStripe({ publishableKey, merchantIdentifier: 'merchant.com.samerodeh.localgo' });
  stripeReadyFor = publishableKey;
}

/**
 * Full charge: quote it, open the sheet, wait for the customer.
 *
 * Never throws — every failure comes back as a `PayOutcome` so the caller can
 * tell "user changed their mind" apart from "card declined", which matter
 * differently to the UI.
 */
export async function payForOrder(input: PaymentInput): Promise<PayOutcome> {
  let quote: PaymentQuote;
  try {
    quote = await createPaymentIntent(input);
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : 'We could not start your payment.',
    };
  }

  const decided = precheckQuote(quote);
  if (decided) return decided;

  try {
    await ensureStripe(quote.publishableKey);

    const init = await initPaymentSheet({
      merchantDisplayName: 'LocalGO',
      paymentIntentClientSecret: quote.clientSecret,
      // Must match `expo.scheme` in app.json, or bank redirect flows (3-D
      // Secure) can't get back into the app and the payment hangs.
      returnURL: 'localgo://stripe-redirect',
      // Delivery starts as soon as the order lands on the driver feed, so we
      // can't accept methods that settle days later.
      allowsDelayedPaymentMethods: false,
    });
    if (init.error) {
      return { status: 'failed', message: init.error.message };
    }

    const result = await presentPaymentSheet();
    if (result.error) {
      // Stripe reports a dismissed sheet as an error with code 'Canceled'.
      if (result.error.code === 'Canceled') return { status: 'canceled' };
      return { status: 'failed', message: result.error.message };
    }

    return { status: 'succeeded', paymentIntentId: quote.paymentIntentId, quote };
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : 'Your payment could not be completed.',
    };
  }
}
