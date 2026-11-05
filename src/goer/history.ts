import { customerToken, validateCart, type ServerCart } from '../lib/serverCart';
import type { ApiMessage, GoerMessage, ServerProduct } from './types';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
export const HISTORY_PAGE_SIZE = 20;
export const HISTORY_TURN_LIMIT = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Envelope {
  conversation_id: string;
  turn_id: string;
  text: string;
  cards: { type: string; cart?: ServerCart; items?: ServerProduct[];
    product?: ServerProduct; description?: string }[];
}
export interface HistoryConversation { id: string; title: string; updated_at: string }
export interface HistoryTurn { message: string; response: Envelope; created_at: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function product(value: unknown): value is ServerProduct {
  return record(value) && ['product_id', 'merchant_id', 'name', 'display_price'].every(k => typeof value[k] === 'string')
    && value.currency === 'CAD' && (value.description === undefined || typeof value.description === 'string');
}
export function parseEnvelope(value: unknown): Envelope {
  if (!record(value) || typeof value.conversation_id !== 'string' || !UUID.test(value.conversation_id)
      || typeof value.turn_id !== 'string' || !UUID.test(value.turn_id)
      || typeof value.text !== 'string' || value.text.length > 8000
      || !Array.isArray(value.cards) || value.cards.length > 1) throw new Error('Invalid saved Goer response.');
  for (const card of value.cards) {
    if (!record(card) || typeof card.type !== 'string') throw new Error('Invalid Goer card.');
    if (card.type === 'cart_summary') validateCart(card.cart);
    if (card.type === 'product_list' && (!Array.isArray(card.items) || card.items.length > 5
      || !card.items.every(product))) throw new Error('Invalid Goer products.');
    if (card.type === 'product_detail' && (!product(card.product)
      || (card.description !== undefined && typeof card.description !== 'string'))) throw new Error('Invalid Goer product.');
  }
  return value as unknown as Envelope;
}

async function request(email: string, path: string, body?: object, expectedUserId?: string): Promise<unknown> {
  if (!URL || !KEY) throw new Error('Supabase history is not configured.');
  const { token, userId } = await customerToken(email);
  if (expectedUserId && userId !== expectedUserId) throw new Error('The signed-in account changed.');
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15000);
  try {
    // Capture this session's bearer; a global SDK session could switch accounts
    // between the ownership check and dispatching the request.
    const response = await fetch(`${URL}/rest/v1/${path}`, {
      method: body ? 'POST' : 'GET', signal: abort.signal,
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Saved history is unavailable. Check the history migration and sign-in.');
    return response.status === 204 ? null : await response.json();
  } finally { clearTimeout(timer); }
}

export async function saveHistoryTurn(email: string, userId: string, message: string, response: Envelope): Promise<void> {
  await request(email, 'rpc/save_goer_history_turn', { p_conversation_id: response.conversation_id,
    p_request_id: response.turn_id, p_message: message, p_response: response }, userId);
}
export async function listHistory(email: string, offset = 0): Promise<HistoryConversation[]> {
  const rows = await request(email, `goer_conversations?select=id,title,updated_at&order=updated_at.desc,id.desc&limit=${HISTORY_PAGE_SIZE}&offset=${offset}`);
  if (!Array.isArray(rows) || !rows.every(r => record(r) && typeof r.id === 'string' && UUID.test(r.id)
      && typeof r.title === 'string' && typeof r.updated_at === 'string')) throw new Error('Invalid saved history.');
  return rows as HistoryConversation[];
}
export async function loadHistory(email: string, id: string): Promise<HistoryTurn[]> {
  if (!UUID.test(id)) throw new Error('Invalid conversation ID.');
  const rows = await request(email, `goer_history_turns?select=message,response,created_at&conversation_id=eq.${id}&order=sequence.desc&limit=${HISTORY_TURN_LIMIT}`);
  if (!Array.isArray(rows)) throw new Error('Invalid saved conversation.');
  return rows.reverse().map(row => {
    if (!record(row) || typeof row.message !== 'string' || typeof row.created_at !== 'string') {
      throw new Error('Invalid saved turn.');
    }
    const response = parseEnvelope(row.response);
    if (response.conversation_id !== id) throw new Error('Invalid saved conversation identity.');
    return { message: row.message, response, created_at: row.created_at };
  });
}

export function transcript(turns: HistoryTurn[]): { uiMessages: GoerMessage[]; apiMessages: ApiMessage[] } {
  const uiMessages: GoerMessage[] = [];
  const apiMessages: ApiMessage[] = [];
  for (const turn of turns) {
    const envelope = turn.response;
    const agent = envelope.cards.some(c => c.type === 'cart_summary') ? 'cart' : 'concierge';
    const base = { createdAt: turn.created_at, agent } as const;
    uiMessages.push({ ...base, id: `${envelope.turn_id}:user`, kind: 'text', role: 'user', text: turn.message },
      { ...base, id: `${envelope.turn_id}:assistant`, kind: 'text', role: 'assistant', text: envelope.text });
    apiMessages.push({ role: 'user', content: turn.message }, { role: 'assistant', content: envelope.text });
    envelope.cards.forEach((card, index) => {
      const identity = { ...base, id: `${envelope.turn_id}:card:${index}` };
      if (card.type === 'cart_summary' && card.cart) {
        const cart = validateCart(card.cart);
        uiMessages.push({ ...identity, kind: 'cart_summary', snapshot: {
          lines: cart.lines.map(line => ({ itemID: line.product_id, name: line.name,
            quantity: line.quantity, unitPrice: line.unit_price_cents / 100 })),
          subtotal: cart.subtotal_cents / 100, deliveryFee: cart.delivery_fee_cents / 100, total: cart.total_cents / 100,
        } });
      } else if (card.type === 'product_list' && card.items) {
        uiMessages.push({ ...identity, kind: 'server_products', items: card.items });
      } else if (card.type === 'product_detail' && card.product) {
        uiMessages.push({ ...identity, kind: 'server_products', items: [{ ...card.product, description: card.description }] });
      }
    });
  }
  return { uiMessages, apiMessages };
}
