import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { customerToken, serverCartEnabled } from '../lib/serverCart';
import { useCartStore } from '../store/cartStore';
import { goerMsg, goerOwnerGeneration, useGoerStore } from './goerStore';
import { listHistory, loadHistory, parseEnvelope, saveHistoryTurn, transcript, type Envelope } from './history';

const GOER_URL = process.env.EXPO_PUBLIC_GOER_API_URL?.replace(/\/+$/, '');
export const authenticatedGoerEnabled = serverCartEnabled && Boolean(GOER_URL);
interface PendingTurn { ownerId: string; conversationId: string; requestId: string; message: string; response?: Envelope }
interface Session { conversationId?: string; pending?: PendingTurn; startNew?: boolean }
const sessionKey = (email: string, userId: string) => `localgo.goer.session:${email.toLowerCase()}:${userId}`;
const readSession = async (key: string): Promise<Session> => JSON.parse(await AsyncStorage.getItem(key) ?? '{}');

export async function resetAuthenticatedConversation(email: string): Promise<void> {
  const { userId } = await customerToken(email);
  const key = sessionKey(email, userId);
  const saved = await readSession(key);
  if (saved.pending) throw new Error('Reconcile the pending turn before starting a new conversation.');
  // Distinguish an explicit new chat from a fresh installation that should
  // restore the latest account conversation. Saved history is never deleted.
  await AsyncStorage.setItem(key, JSON.stringify({ startNew: true }));
}

export async function restoreAuthenticatedConversation(selectedId?: string): Promise<void> {
  const generation = goerOwnerGeneration();
  const email = useGoerStore.getState().ownerEmail;
  if (!email || !authenticatedGoerEnabled) return;
  if (useGoerStore.getState().isStreaming || useGoerStore.getState().isHistoryLoading) {
    throw new Error('Wait for the current request before switching conversations.');
  }
  const current = () => generation === goerOwnerGeneration();
  useGoerStore.setState({ isHistoryLoading: true });
  try {
    const { userId } = await customerToken(email);
    const key = sessionKey(email, userId);
    const saved = await readSession(key);
    if (saved.pending && (saved.pending.ownerId !== userId
      || (selectedId && selectedId !== saved.pending.conversationId))) {
      throw new Error('Retry the pending turn before switching conversations.');
    }
    if (!current()) return;
    useGoerStore.setState({ pendingMessage: saved.pending?.message ?? null });
    const id = saved.pending?.conversationId ?? selectedId ?? saved.conversationId
      ?? (saved.startNew ? undefined : (await listHistory(email))[0]?.id);
    const turns = id ? await loadHistory(email, id) : [];
    const restored = transcript(turns);
    if (saved.pending && !turns.some(turn => turn.response.turn_id === saved.pending!.requestId)) {
      restored.uiMessages.push({ ...goerMsg({ kind: 'text', role: 'user', text: saved.pending.message }),
        id: `${saved.pending.requestId}:user` });
      restored.apiMessages.push({ role: 'user', content: saved.pending.message });
    }
    if (!current() || (await customerToken(email)).userId !== userId || !current()) return;
    await AsyncStorage.setItem(key, JSON.stringify({ ...saved, conversationId: id }));
    if (current()) useGoerStore.getState().restoreTranscript(restored.uiMessages, restored.apiMessages);
  } finally {
    if (current()) useGoerStore.setState({ isHistoryLoading: false });
  }
}

export async function runAuthenticatedGoerTurn(message: string): Promise<void> {
  if (!GOER_URL) throw new Error('The authenticated Goer service is not configured.');
  const generation = goerOwnerGeneration();
  const email = useGoerStore.getState().ownerEmail;
  if (!email) throw new Error('Sign in before using Goer.');
  const { token, userId } = await customerToken(email);
  const key = sessionKey(email, userId);
  const saved = await readSession(key);
  const current = () => goerOwnerGeneration() === generation && useGoerStore.getState().ownerEmail === email;
  if (!current()) return;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (saved.pending && (saved.pending.ownerId !== userId || saved.pending.message !== message)) {
    useGoerStore.setState({ pendingMessage: saved.pending.message });
    throw new Error('A previous turn needs reconciliation. Retry that pending turn first.');
  }
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90000);
  try {
    if (!saved.conversationId) {
      const created = await fetch(`${GOER_URL}/v1/conversations`, { method: 'POST', headers, signal: abort.signal });
      if (!created.ok) throw new Error('Could not create a signed-in conversation. No cart request was sent.');
      const body = await created.json();
      if (typeof body.conversation_id !== 'string') throw new Error('Invalid conversation response.');
      saved.conversationId = body.conversation_id;
    }
    const pending = saved.pending ?? { ownerId: userId, conversationId: saved.conversationId!,
      requestId: Crypto.randomUUID(), message };
    saved.pending = pending;
    await AsyncStorage.setItem(key, JSON.stringify(saved));
    if (!current()) return;
    useGoerStore.setState({ pendingMessage: pending.message });
    let envelope: Envelope;
    if (pending.response) {
      envelope = parseEnvelope(pending.response);
    } else {
      const response = await fetch(`${GOER_URL}/v1/conversations/${encodeURIComponent(pending.conversationId)}/turns`, {
        method: 'POST', headers, signal: abort.signal,
        body: JSON.stringify({ message: pending.message, request_id: pending.requestId }),
      });
      const body = await response.json();
      if (response.status === 202) throw new Error('That turn is still pending.');
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Goer could not finish.');
      envelope = parseEnvelope(body);
    }
    if (envelope.turn_id !== pending.requestId || envelope.conversation_id !== pending.conversationId) {
      throw new Error('Goer returned an invalid response identity.');
    }
    if (!current() || (await customerToken(email)).userId !== userId || !current()) return;
    // Durable completed response lets a history-only retry skip Goer entirely,
    // even if the app restarts while Supabase is unavailable.
    pending.response = envelope;
    await AsyncStorage.setItem(key, JSON.stringify(saved));
    if (!current()) return;
    for (const card of envelope.cards) {
      if (card.type === 'cart_summary' && card.cart) useCartStore.getState().acceptServerCart(card.cart);
    }
    await saveHistoryTurn(email, userId, pending.message, envelope);
    if (!current()) return;
    delete saved.pending;
    await AsyncStorage.setItem(key, JSON.stringify(saved));
    if (!current()) return;
    const store = useGoerStore.getState();
    useGoerStore.setState({ pendingMessage: null });
    const messages = transcript([{ message: pending.message, response: envelope, created_at: new Date().toISOString() }]);
    store.setActiveAgent(envelope.cards.some(c => c.type === 'cart_summary') ? 'cart' : 'concierge', true);
    const alreadyShown = store.uiMessages.some(msg => msg.id === `${envelope.turn_id}:assistant`);
    for (const msg of messages.uiMessages.slice(1)) store.appendMessage(msg);
    if (!alreadyShown) store.appendApiMessage({ role: 'assistant', content: envelope.text });
    try { await useCartStore.getState().refresh(); } catch { /* Completed turn remains completed. */ }
  } catch (error) {
    if (saved.pending?.response) {
      throw new Error('Your turn completed, but saving history is pending. Tap Retry pending turn; the cart edit will not be resent.');
    }
    throw new Error(error instanceof Error ? `${error.message} Retry the pending turn using the same saved request.`
      : 'Connection interrupted. Retry the pending turn using the same saved request.');
  } finally { clearTimeout(timer); }
}
