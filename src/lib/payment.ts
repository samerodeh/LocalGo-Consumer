import { authHeaders } from './authHeaders';
// Real Stripe checkout: the backend mints a PaymentIntent, then Stripe's own
// native PaymentSheet collects card details and confirms it — no card data
// ever touches this app's code or storage. See backend/app/routers/payments.py.
import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';
import { API_URL, isBackendConfigured } from './api';

export type PaymentResult =
  | { ok: true; paymentIntentId: string }
  | { ok: false; error: string };

/** Charges `amountCents` via Stripe PaymentSheet. Requires the backend (holds
 * the Stripe secret key) — there is no offline/demo fallback for real money. */
export async function payWithCard(amountCents: number, currency = 'cad'): Promise<PaymentResult> {
  if (!isBackendConfigured) {
    return { ok: false, error: "Payment isn't available right now." };
  }

  let clientSecret: string;
  try {
    const res = await fetch(`${API_URL}/payments/create-intent`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ amount_cents: amountCents, currency }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[payment] create-intent failed:', res.status, text.slice(0, 200));
      return { ok: false, error: "Payment isn't available right now." };
    }
    const data = await res.json();
    clientSecret = data.client_secret;
  } catch (err) {
    console.warn('[payment] create-intent threw:', err);
    return { ok: false, error: "Couldn't reach the payment service. Check your connection." };
  }

  const init = await initPaymentSheet({
    merchantDisplayName: 'LocalGO',
    paymentIntentClientSecret: clientSecret,
  });
  if (init.error) {
    return { ok: false, error: init.error.message };
  }

  const present = await presentPaymentSheet();
  if (present.error) {
    // 'Canceled' is Stripe's own code for the user dismissing the sheet.
    if (present.error.code === 'Canceled') {
      return { ok: false, error: 'Payment canceled.' };
    }
    return { ok: false, error: present.error.message };
  }

  // clientSecret is "<payment_intent_id>_secret_...".
  const paymentIntentId = clientSecret.split('_secret_')[0];
  return { ok: true, paymentIntentId };
}
