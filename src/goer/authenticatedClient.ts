import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { customerToken, serverCartEnabled, validateCart, type ServerCart } from '../lib/serverCart';
import { useCartStore } from '../store/cartStore';
import { goerMsg, useGoerStore } from './goerStore';
import type { ServerProduct } from './types';

const GOER_URL = process.env.EXPO_PUBLIC_GOER_API_URL?.replace(/\/+$/, '');
export const authenticatedGoerEnabled = serverCartEnabled && Boolean(GOER_URL);
interface PendingTurn { ownerId: string; conversationId: string; requestId: string; message: string }
interface Envelope { conversation_id: string; turn_id: string; text: string; cards: {
  type: string; cart?: ServerCart; items?: ServerProduct[]; product?: ServerProduct; description?: string;
}[] }

export async function resetAuthenticatedConversation(email: string): Promise<void> {
  const { userId } = await customerToken(email);
  const key = `localgo.goer.session:${email.toLowerCase()}:${userId}`;
  const saved = JSON.parse(await AsyncStorage.getItem(key) ?? 'null') as { pending?: PendingTurn } | null;
  if (saved?.pending) throw new Error('Reconcile the pending turn before starting a new conversation.');
  await AsyncStorage.removeItem(key);
}

export async function runAuthenticatedGoerTurn(message: string): Promise<void> {
  if (!GOER_URL) throw new Error('The authenticated Goer service is not configured.');
  const email = useGoerStore.getState().ownerEmail;
  if (!email) throw new Error('Sign in before using Goer.');
  const { token, userId } = await customerToken(email);
  const key = `localgo.goer.session:${email.toLowerCase()}:${userId}`;
  const raw = await AsyncStorage.getItem(key);
  const saved = raw ? JSON.parse(raw) as { conversationId?: string; pending?: PendingTurn } : {};
  const current = () => useGoerStore.getState().ownerEmail === email;
  if (!current()) return;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (saved.pending && (saved.pending.ownerId !== userId || saved.pending.message !== message)) {
    throw new Error('A previous turn needs reconciliation. Resend that exact message before starting another.');
  }
  if (!saved.conversationId) {
    const created = await fetch(`${GOER_URL}/v1/conversations`, { method: 'POST', headers });
    if (!created.ok) throw new Error('Could not create a signed-in conversation. No cart request was sent.');
    saved.conversationId = (await created.json()).conversation_id;
  }
  const pending = saved.pending ?? { ownerId: userId, conversationId: saved.conversationId!,
    requestId: Crypto.randomUUID(), message };
  saved.pending = pending;
  await AsyncStorage.setItem(key, JSON.stringify(saved));
  if (!current()) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90000);
  try {
    const response = await fetch(`${GOER_URL}/v1/conversations/${encodeURIComponent(pending.conversationId)}/turns`, {
      method: 'POST', headers, signal: abort.signal,
      body: JSON.stringify({ message: pending.message, request_id: pending.requestId }),
    });
    const body = await response.json();
    if (response.status === 202) throw new Error('That turn is still pending. Resend the same message to reconcile it.');
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Goer could not finish. Retry the same message.');
    const envelope = body as Envelope;
    if (envelope.turn_id !== pending.requestId || envelope.conversation_id !== pending.conversationId
        || typeof envelope.text !== 'string' || !Array.isArray(envelope.cards)) {
      throw new Error('Goer returned an invalid response. Retry the same message.');
    }
    // Recheck account identity after awaiting the network; no old-account data
    // is applied to a new account after logout or switching.
    const active = await customerToken(email);
    if (!current() || active.userId !== userId) return;
    const agent = envelope.cards.some(card => card.type === 'cart_summary') ? 'cart' : 'concierge';
    const store = useGoerStore.getState();
    store.setActiveAgent(agent, true);
    store.appendMessage(goerMsg({ kind: 'text', role: 'assistant', agent, text: envelope.text }));
    store.appendApiMessage({ role: 'assistant', content: envelope.text });
    for (const card of envelope.cards) {
      if (card.type === 'cart_summary' && card.cart) {
        const cart = validateCart(card.cart);
        useCartStore.getState().acceptServerCart(cart);
        store.appendMessage(goerMsg({ kind: 'cart_summary', agent, snapshot: {
          lines: cart.lines.map(line => ({ itemID: line.product_id, name: line.name,
            quantity: line.quantity, unitPrice: line.unit_price_cents / 100 })),
          subtotal: cart.subtotal_cents / 100, deliveryFee: cart.delivery_fee_cents / 100, total: cart.total_cents / 100,
        } }));
      } else if (card.type === 'product_list' && Array.isArray(card.items)) {
        store.appendMessage(goerMsg({ kind: 'server_products', items: card.items, agent }));
      } else if (card.type === 'product_detail' && card.product) {
        store.appendMessage(goerMsg({ kind: 'server_products', items: [{ ...card.product, description: card.description }], agent }));
      }
    }
    delete saved.pending;
    await AsyncStorage.setItem(key, JSON.stringify(saved));
    try { await useCartStore.getState().refresh(); } catch { /* Completed turn remains completed. */ }
  } catch (error) {
    // Never replay this message through the old assistant or offline NLU.
    throw new Error(error instanceof Error ? `${error.message} Pending request is saved; resend the same message.`
      : 'Connection interrupted. Resend the same message to reconcile it.');
  } finally { clearTimeout(timer); }
}
