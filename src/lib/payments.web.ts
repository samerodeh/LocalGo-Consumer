// Web build of payments.ts. `@stripe/stripe-react-native` is native-only and
// breaks the web bundle, so the browser build (used for local development
// testing of sign-in, chat, cart and history) cannot take payments at all.
// It never creates a PaymentIntent: checkout must run in the native app, where
// the Stripe PaymentSheet handles card entry and bank authentication.
import type { CartLine } from '../types';
import { isBackendConfigured } from './api';

export const isPaymentsConfigured = isBackendConfigured;

export interface PaymentQuote {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  currency: string;
  subtotalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
  paymentStatus?: string;
  cartRevision?: number;
}

export type PayOutcome =
  | { status: 'succeeded'; paymentIntentId: string; quote: PaymentQuote }
  | { status: 'canceled' }
  | { status: 'failed'; message: string };

const WEB_MESSAGE = 'Payment requires the LocalGo mobile app. No charge was made.';

type PaymentInput = {
  orderId: string;
  lines: CartLine[];
  tip: number;
  accessToken: string | null;
  cartRevision?: number;
};

export async function createPaymentIntent(_input: PaymentInput): Promise<PaymentQuote> {
  throw new Error(WEB_MESSAGE);
}

export async function payForOrder(_input: PaymentInput): Promise<PayOutcome> {
  return { status: 'failed', message: WEB_MESSAGE };
}
