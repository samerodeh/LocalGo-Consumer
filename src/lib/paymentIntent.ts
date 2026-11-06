// Shared by payments.ts (native PaymentSheet) and payments.web.ts (Stripe.js
// Payment Element). The app never computes or sends an amount: it posts the
// order id and cart revision (or item ids), and the backend reprices and
// returns a client secret for the amount it decided.
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
  /** User dismissed the payment UI. Not an error — the caller should stay put and say nothing. */
  | { status: 'canceled' }
  | { status: 'failed'; message: string };

export interface PaymentInput {
  orderId: string;
  lines: CartLine[];
  tip: number;
  accessToken: string | null;
  cartRevision?: number;
}

/**
 * Ask the backend to price this cart and open a PaymentIntent for it.
 * Throws on any failure — the message is safe to show the user.
 */
export async function createPaymentIntent(input: PaymentInput): Promise<PaymentQuote> {
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

/** Outcomes decided before any payment UI is shown; null means "show the UI". */
export function precheckQuote(quote: PaymentQuote): PayOutcome | null {
  if (quote.paymentStatus === 'succeeded') {
    return { status: 'succeeded', paymentIntentId: quote.paymentIntentId, quote };
  }
  if (quote.paymentStatus === 'processing') {
    return { status: 'failed', message: 'Payment is still processing. Reconcile this same checkout shortly.' };
  }
  return null;
}
