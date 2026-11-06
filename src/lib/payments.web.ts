// Web build of payments.ts: Stripe.js Payment Element instead of the native
// PaymentSheet (the React Native SDK is native-only and breaks the web bundle).
//
// Card entry and bank authentication (3-D Secure) happen inside Stripe's own
// iframes, so card data never touches this app or its backend. The amount is
// whatever the backend priced into the PaymentIntent; this module only shows it.
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import {
  createPaymentIntent,
  precheckQuote,
  type PaymentInput,
  type PaymentQuote,
  type PayOutcome,
} from './paymentIntent';

export { createPaymentIntent, isPaymentsConfigured } from './paymentIntent';
export type { PaymentQuote, PayOutcome } from './paymentIntent';

const stripeByKey = new Map<string, Promise<Stripe | null>>();

function stripeFor(publishableKey: string): Promise<Stripe | null> {
  let stripe = stripeByKey.get(publishableKey);
  if (!stripe) {
    stripe = loadStripe(publishableKey);
    stripeByKey.set(publishableKey, stripe);
  }
  return stripe;
}

function formatTotal(quote: PaymentQuote): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: quote.currency.toUpperCase() })
    .format(quote.totalCents / 100);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style: Partial<CSSStyleDeclaration>,
  text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node.style, style);
  if (text) node.textContent = text;
  return node;
}

/** Modal with the Payment Element. Resolves once the customer pays or cancels. */
function presentPaymentDialog(stripe: Stripe, quote: PaymentQuote): Promise<PayOutcome> {
  return new Promise((resolve) => {
    const overlay = el('div', {
      position: 'fixed', inset: '0', background: 'rgba(15,23,42,0.55)', zIndex: '10000',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Payment');
    const card = el('div', {
      background: '#fff', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '440px',
      maxHeight: '90vh', overflowY: 'auto', fontFamily: 'system-ui, sans-serif', color: '#0f172a',
    });
    const title = el('div', { fontSize: '18px', fontWeight: '700', marginBottom: '4px' }, 'LocalGO payment');
    const amount = el('div', { fontSize: '14px', color: '#475569', marginBottom: '16px' },
      `Total: ${formatTotal(quote)}`);
    const mount = el('div', { minHeight: '120px' });
    const error = el('div', { color: '#dc2626', fontSize: '13px', minHeight: '18px', margin: '10px 0' });
    error.setAttribute('role', 'alert');
    const buttons = el('div', { display: 'flex', gap: '10px' });
    const buttonStyle = { flex: '1', padding: '12px', borderRadius: '10px', fontSize: '15px',
      fontWeight: '600', cursor: 'pointer', border: 'none' };
    const cancel = el('button', { ...buttonStyle, background: '#e2e8f0', color: '#0f172a' }, 'Cancel');
    const pay = el('button', { ...buttonStyle, background: '#f97316', color: '#fff' }, `Pay ${formatTotal(quote)}`);
    cancel.type = pay.type = 'button';
    buttons.append(cancel, pay);
    card.append(title, amount, mount, error, buttons);
    overlay.append(card);
    document.body.append(overlay);

    const elements: StripeElements = stripe.elements({ clientSecret: quote.clientSecret });
    const paymentElement = elements.create('payment', { layout: 'tabs' });
    paymentElement.mount(mount);

    let busy = false;
    const finish = (outcome: PayOutcome) => {
      paymentElement.destroy();
      overlay.remove();
      resolve(outcome);
    };
    const setBusy = (value: boolean) => {
      busy = value;
      pay.disabled = cancel.disabled = value;
      pay.style.opacity = value ? '0.6' : '1';
      pay.textContent = value ? 'Processing…' : `Pay ${formatTotal(quote)}`;
    };

    cancel.onclick = () => { if (!busy) finish({ status: 'canceled' }); };
    pay.onclick = async () => {
      if (busy) return;
      setBusy(true);
      error.textContent = '';
      try {
        const result = await stripe.confirmPayment({
          elements,
          // Cards (including 3-D Secure) complete in place. Redirect-based
          // methods would leave the page, so they come back to the same URL.
          redirect: 'if_required',
          confirmParams: { return_url: window.location.href },
        });
        if (result.error) {
          // Declines and validation errors keep the dialog open so the customer
          // can fix the card or cancel, like the native PaymentSheet.
          error.textContent = result.error.message ?? 'Your payment could not be completed.';
          setBusy(false);
          return;
        }
        const status = result.paymentIntent?.status;
        if (status === 'succeeded') {
          finish({ status: 'succeeded', paymentIntentId: quote.paymentIntentId, quote });
        } else if (status === 'processing') {
          finish({ status: 'failed', message: 'Payment is still processing. Reconcile this same checkout shortly.' });
        } else {
          error.textContent = 'Payment was not completed. Try again or use another card.';
          setBusy(false);
        }
      } catch {
        error.textContent = 'Your payment could not be completed. Please try again.';
        setBusy(false);
      }
    };
  });
}

/**
 * Full charge: quote it, show Stripe's payment form, wait for the customer.
 * Never throws — every failure comes back as a `PayOutcome`.
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
    const stripe = await stripeFor(quote.publishableKey);
    if (!stripe) return { status: 'failed', message: 'Payments are unavailable right now.' };
    return await presentPaymentDialog(stripe, quote);
  } catch (err) {
    return {
      status: 'failed',
      message: err instanceof Error ? err.message : 'Your payment could not be completed.',
    };
  }
}
