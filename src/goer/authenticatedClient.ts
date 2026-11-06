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
const sessionQueues = new Map<string, Promise<void>>();
function sessionOperation<T>(key: string, operation: (saved: Session) => Promise<T> | T): Promise<T> {
  const work = (sessionQueues.get(key) ?? Promise.resolve()).then(async () =>
    operation(JSON.parse(await AsyncStorage.getItem(key) ?? '{}')));
  const tail = work.then(() => {}, () => {});
  sessionQueues.set(key, tail);
  void tail.then(() => { if (sessionQueues.get(key) === tail) sessionQueues.delete(key); });
  return work;
}
const readSession = (key: string) => sessionOperation(key, saved => saved);
async function writeSession(key: string, saved: Session, current: () => boolean,
  expected: { conversationId?: string; requestId?: string }): Promise<boolean> {
  return sessionOperation(key, async latest => {
    if (!current()) return false;
    if (latest.conversationId !== expected.conversationId || latest.pending?.requestId !== expected.requestId) {
      throw new Error('The conversation changed. Reload history before retrying.');
    }
    await AsyncStorage.setItem(key, JSON.stringify(saved));
    return true;
  });
}

export async function resetAuthenticatedConversation(email: string): Promise<void> {
  const generation = goerOwnerGeneration();
  const { userId } = await customerToken(email);
  await sessionOperation(sessionKey(email, userId), async saved => {
    if (generation !== goerOwnerGeneration()) return;
    if (saved.pending) throw new Error('Reconcile the pending turn before starting a new conversation.');
    // Explicit new chat must not restore the latest saved account conversation.
    await AsyncStorage.setItem(sessionKey(email, userId), JSON.stringify({ startNew: true }));
  });
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
    await writeSession(key, { ...saved, conversationId: id }, current,
      { conversationId: saved.conversationId, requestId: saved.pending?.requestId });
    if (current()) useGoerStore.getState().restoreTranscript(restored.uiMessages, restored.apiMessages);
  } finally {
    if (current()) useGoerStore.setState({ isHistoryLoading: false });
  }
}

export async function runAuthenticatedGoerTurn(message: string, localReply?: () => Promise<string>): Promise<void> {
  if (!GOER_URL) throw new Error('The authenticated Goer service is not configured.');
  const generation = goerOwnerGeneration();
  const email = useGoerStore.getState().ownerEmail;
  if (!email) throw new Error('Sign in before using Goer.');
  const { token, userId } = await customerToken(email);
  const key = sessionKey(email, userId);
  const saved = await readSession(key);
  const expected = { conversationId: saved.conversationId, requestId: saved.pending?.requestId };
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
      if (!current()) return;
      if (typeof body.conversation_id !== 'string') throw new Error('Invalid conversation response.');
      saved.conversationId = body.conversation_id;
    }
    const pending = saved.pending ?? { ownerId: userId, conversationId: saved.conversationId!,
      requestId: Crypto.randomUUID(), message };
    saved.pending = pending;
    if (!await writeSession(key, saved, current, expected) || !current()) return;
    useGoerStore.setState({ pendingMessage: pending.message });
    let envelope: Envelope;
    if (pending.response) {
      envelope = parseEnvelope(pending.response);
    } else if (localReply) {
      if (!current()) return;
      const text = await localReply();
      if (!current()) return;
      envelope = parseEnvelope({ conversation_id: pending.conversationId, turn_id: pending.requestId,
        trace_id: Crypto.randomUUID(), text, cards: [], actions: [] });
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
    const pendingIdentity = { conversationId: pending.conversationId, requestId: pending.requestId };
    if (!await writeSession(key, saved, current, pendingIdentity) || !current()) return;
    for (const card of envelope.cards) {
      if (card.type === 'cart_summary' && card.cart) useCartStore.getState().acceptServerCart(card.cart);
    }
    await saveHistoryTurn(email, userId, pending.message, envelope);
    if (!current()) return;
    delete saved.pending;
    if (!await writeSession(key, saved, current, pendingIdentity) || !current()) return;
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
