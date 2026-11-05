// Stripe PaymentSheet — the real charge that replaced checkout's simulated
// `setTimeout`. Deliberately a plain module rather than a hook: both entry
// points to checkout (the Cart screen and Goer's in-chat confirmation card) go
// through `placeOrder`, which is called outside React, and
// initPaymentSheet/presentPaymentSheet are module-level functions.
//
// The app never computes or sends an amount. It posts item ids and quantities;
// the backend reprices from its own menu (backend/app/pricing.py) and returns a
// client secret for the amount it decided. Whatever total the cart is showing
// is a display value only.
//
// The publishable key also comes from that response rather than from a bundled
// env var, so there is exactly one place a Stripe key is configured (the
// backend) and the two can never drift apart.
import {
  initPaymentSheet,
  initStripe,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import type { CartLine } from '../types';
import { API_URL, isBackendConfigured } from './api';
import { serverCartEnabled } from './serverCart';

/** Real card payments require the backend that issues the PaymentIntent. */
export const isPaymentsConfigured = isBackendConfigured;

export interface PaymentQuote {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  currency: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  /** What the customer will actually be charged, per the server. */
  totalCents: number;
  paymentStatus?: string;
  cartRevision?: number;
}

export type PayOutcome =
  | { status: 'succeeded'; paymentIntentId: string; quote: PaymentQuote }
  /** User dismissed the sheet. Not an error — the caller should stay put and say nothing. */
  | { status: 'canceled' }
  | { status: 'failed'; message: string };

let stripeReadyFor: string | null = null;

/** initStripe is idempotent but not free; only re-run it if the key changes. */
async function ensureStripe(publishableKey: string): Promise<void> {
  if (stripeReadyFor === publishableKey) return;
  await initStripe({ publishableKey, merchantIdentifier: 'merchant.com.samerodeh.localgo' });
  stripeReadyFor = publishableKey;
}

/**
 * Ask the backend to price this cart and open a PaymentIntent for it.
 * Throws on any failure — the message is safe to show the user.
 */
export async function createPaymentIntent(input: {
  orderId: string;
  lines: CartLine[];
  tip: number;
  accessToken: string | null;
  cartRevision?: number;
}): Promise<PaymentQuote> {
  if (!API_URL) throw new Error('Payments are unavailable right now.');

  const res = await fetch(`${API_URL}/payments/intent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}),
    },
    body: JSON.stringify({
      order_id: input.orderId,
      // Ids and quantities only. Prices are the server's business.
      ...(serverCartEnabled ? { cart_revision: input.cartRevision }
        : { items: input.lines.map((l) => ({ id: l.item.id, quantity: l.quantity })) }),
      tip_cents: Math.round(input.tip * 100),
    }),
  });

  if (!res.ok) {
    // The backend's 422s are written for humans (unknown item, tip too large,
    // menu unavailable), so surface them as-is when we can parse one out.
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? null))
      .catch(() => null);
    throw new Error(detail ?? 'We could not start your payment. Please try again.');
  }

  const data = await res.json();
  return {
    paymentIntentId: data.payment_intent_id,
    clientSecret: data.client_secret,
    publishableKey: data.publishable_key,
    currency: data.currency,
    subtotalCents: data.subtotal_cents,
    deliveryFeeCents: data.delivery_fee_cents,
    tipCents: data.tip_cents,
    totalCents: data.total_cents,
    paymentStatus: data.payment_status,
    cartRevision: data.cart_revision,
  };
}

/**
 * Full charge: quote it, open the sheet, wait for the customer.
 *
 * Never throws — every failure comes back as a `PayOutcome` so the caller can
 * tell "user changed their mind" apart from "card declined", which matter
 * differently to the UI.
 */
export async function payForOrder(input: {
  orderId: string;
  lines: CartLine[];
  tip: number;
  accessToken: string | null;
  cartRevision?: number;
}): Promise<PayOutcome> {
  let quote: PaymentQuote;
  try {
    quote = await createPaymentIntent(input);
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : 'We could not start your payment.',
    };
  }

  if (quote.paymentStatus === 'succeeded') {
    return { status: 'succeeded', paymentIntentId: quote.paymentIntentId, quote };
  }
  if (quote.paymentStatus === 'processing') return { status: 'failed', message: 'Payment is still processing. Reconcile this same checkout shortly.' };

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
