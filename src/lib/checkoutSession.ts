import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { API_URL } from './api';
import { customerToken } from './serverCart';

export interface CheckoutPin { ownerId: string; orderId: string; revision: number; tipCents: number }
const keyFor = (email: string, owner: string) => `localgo.checkout:${email.toLowerCase()}:${owner}`;

async function call(email: string, path: string, method = 'GET'): Promise<{ status: number; body: any }> {
  if (!API_URL) throw new Error('LocalGo checkout is not configured.');
  const { token } = await customerToken(email);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API_URL + path, { method, signal: controller.signal,
      headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  } finally { clearTimeout(timer); }
}

function problem(body: any): string {
  return typeof body?.detail === 'string' ? body.detail : body?.detail?.message ?? 'Could not reconcile checkout. Retry without starting another order.';
}

export async function beginCheckout(email: string, revision: number, tipCents: number): Promise<CheckoutPin> {
  const { userId } = await customerToken(email);
  const key = keyFor(email, userId);
  let saved = JSON.parse(await AsyncStorage.getItem(key) ?? 'null') as CheckoutPin | null;
  const active = await call(email, '/v1/cart/checkout');
  if (active.status !== 200) throw new Error(problem(active.body));
  const remote = active.body.checkout;
  if (remote) saved = { ownerId: userId, orderId: remote.order_id,
    revision: remote.cart_revision, tipCents: remote.tip_cents };
  else if (saved) {
    if (saved.ownerId !== userId) throw new Error('The saved checkout belongs to another account.');
    const status = await call(email, `/payments/cart/${encodeURIComponent(saved.orderId)}`);
    if (status.status === 200 && ['consumed', 'released'].includes(status.body.status)) saved = null;
    else if (status.status !== 200 && status.status !== 404) throw new Error(problem(status.body));
  }
  if (saved && (saved.revision !== revision || saved.tipCents !== tipCents)) {
    throw new Error('An earlier checkout is unfinished. Finish it with its original tip or cancel it before starting another.');
  }
  const pin = saved ?? { ownerId: userId, orderId: Crypto.randomUUID(), revision, tipCents };
  await AsyncStorage.setItem(key, JSON.stringify(pin));
  return pin;
}

export async function forgetCheckout(email: string, ownerId: string, orderId: string): Promise<void> {
  const key = keyFor(email, ownerId);
  const saved = JSON.parse(await AsyncStorage.getItem(key) ?? 'null') as CheckoutPin | null;
  if (saved?.orderId === orderId) await AsyncStorage.removeItem(key);
}

export async function cancelPendingCheckout(email: string): Promise<void> {
  const { userId } = await customerToken(email);
  const key = keyFor(email, userId);
  const active = await call(email, '/v1/cart/checkout');
  if (active.status !== 200) throw new Error(problem(active.body));
  const saved = JSON.parse(await AsyncStorage.getItem(key) ?? 'null') as CheckoutPin | null;
  const orderId = active.body.checkout?.order_id ?? saved?.orderId;
  if (!orderId) return;
  const response = await call(email, `/payments/cart/${encodeURIComponent(orderId)}/cancel`, 'POST');
  if (response.status !== 200) throw new Error(problem(response.body));
  await AsyncStorage.removeItem(key);
}
