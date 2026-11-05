import { API_URL } from './api';
import { supabase } from './supabase';

export const serverCartEnabled = process.env.EXPO_PUBLIC_SERVER_CART_ENABLED === 'true';

export interface ServerCart {
  revision: number;
  merchant_id: string | null;
  currency: 'CAD';
  lines: { product_id: string; name: string; quantity: number; unit_price_cents: number; line_total_cents: number }[];
  subtotal_cents: number;
  delivery_fee_cents: number;
  total_cents: number;
}
export interface CartRequest { ownerId: string; method: 'POST' | 'PATCH' | 'DELETE'; path: string; body: Record<string, unknown>; key: string }

export class CartApiError extends Error {
  constructor(message: string, readonly uncertain: boolean) { super(message); }
}

export async function customerToken(email: string): Promise<{ token: string; userId: string }> {
  if (!supabase) throw new CartApiError('Sign in with a LocalGo account to use the server cart.', true);
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (error || !session || session.user.email?.toLowerCase() !== email.toLowerCase()) {
    throw new CartApiError('Your session changed or expired. Sign in again.', true);
  }
  return { token: session.access_token, userId: session.user.id };
}

export function validateCart(value: unknown): ServerCart {
  const cart = value as ServerCart;
  if (!cart || cart.currency !== 'CAD' || !Number.isSafeInteger(cart.revision) || cart.revision < 0
      || !Array.isArray(cart.lines) || cart.lines.length > 50
      || ![cart.subtotal_cents, cart.delivery_fee_cents, cart.total_cents].every(n => Number.isSafeInteger(n) && n >= 0)
      || !cart.lines.every(l => typeof l.product_id === 'string' && typeof l.name === 'string'
        && Number.isSafeInteger(l.quantity) && l.quantity > 0 && l.quantity <= 99
        && Number.isSafeInteger(l.unit_price_cents) && l.unit_price_cents >= 0
        && l.line_total_cents === l.quantity * l.unit_price_cents)
      || cart.subtotal_cents !== cart.lines.reduce((n, l) => n + l.line_total_cents, 0)
      || cart.total_cents !== cart.subtotal_cents + cart.delivery_fee_cents) {
    throw new CartApiError('The server returned an invalid cart. Refresh before continuing.', true);
  }
  return cart;
}

export async function requestCart(email: string, request?: CartRequest): Promise<ServerCart> {
  if (!API_URL) throw new CartApiError('The LocalGo backend is not configured.', true);
  const { token, userId } = await customerToken(email);
  if (request && (request.ownerId !== userId || !/^[a-zA-Z0-9._:-]{1,200}$/.test(request.key)
      || !((request.method === 'POST' && ['/v1/cart/clear', '/v1/cart/lines'].includes(request.path))
        || (['PATCH', 'DELETE'].includes(request.method) && /^\/v1\/cart\/lines\/[a-zA-Z0-9_%.-]+$/.test(request.path) && !request.path.includes('..'))))) {
    throw new CartApiError('This pending request does not belong to the active account or cart API.', false);
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const response = await fetch(API_URL + (request?.path ?? '/v1/cart'), {
      method: request?.method ?? 'GET', signal: abort.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
        ...(request ? { 'Idempotency-Key': request.key } : {}) },
      ...(request ? { body: JSON.stringify(request.body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) {
      const detail = data.detail;
      throw new CartApiError(typeof detail === 'string' ? detail : detail?.message ?? 'Cart request failed.',
        response.status >= 500 || response.status === 401);
    }
    return validateCart(data);
  } catch (error) {
    if (error instanceof CartApiError) throw error;
    throw new CartApiError('Connection interrupted. Retry the pending cart request before making another change.', true);
  } finally { clearTimeout(timer); }
}
