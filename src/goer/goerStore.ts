import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import type { CartLine } from '../types';
import { loadGoerChat, saveGoerChat } from '../lib/storage';
import { placeOrder } from '../lib/placeOrder';
import { deliveryLocationProblem } from '../lib/deliveryLocation';
import { serverCartEnabled } from '../lib/serverCart';
import { useCartStore } from '../store/cartStore';
import { useOrdersStore } from '../store/ordersStore';
import { useAddressStore } from '../store/addressStore';
import { useAuthStore } from '../store/authStore';
import { isGoerLLMConfigured, MAX_API_MESSAGES, MAX_UI_MESSAGES } from './config';
import type {
  ApiMessage,
  ChatTip,
  GoerAgentId,
  GoerMessage,
  PersistedGoerChat,
  StagedOrder,
} from './types';

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Fingerprint of the cart contents, used to detect edits between the moment an
 *  order confirmation is staged and the moment the user taps Confirm. */
export function computeCartHash(lines: CartLine[]): string {
  return lines
    .map((l) => `${l.item.id}:${l.quantity}`)
    .sort()
    .join('|');
}

/** Omit that distributes over unions — plain Omit would collapse GoerMessage's
 *  variants down to their common keys. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** Builds a transcript message with identity fields filled in. */
export function goerMsg(body: DistributiveOmit<GoerMessage, 'id' | 'createdAt'>): GoerMessage {
  return { ...body, id: Crypto.randomUUID(), createdAt: new Date().toISOString() } as GoerMessage;
}

export function resolveTip(tip: ChatTip, subtotal: number): number {
  if (tip.kind === 'amount') return round2(Math.max(0, tip.value));
  return round2((subtotal * tip.value) / 100);
}

const DEFAULT_TIP: ChatTip = { kind: 'percent', value: 18 };

const DEFAULT_QUICK_REPLIES = [
  'Show me the menu',
  "What's in my cart?",
  'Checkout',
  "Where's my order?",
];

interface GoerState {
  ownerEmail: string | null;
  isOpen: boolean;
  /** 'llm' streams a turn from the backend's agent pipeline; 'fallback' is the
   *  on-device rule-based assistant. Downgrades stick for the session. */
  mode: 'llm' | 'fallback';
  activeAgent: GoerAgentId;
  uiMessages: GoerMessage[];
  apiMessages: ApiMessage[];
  /** True while a turn is running (streaming or executing tools). */
  isStreaming: boolean;
  isHistoryLoading: boolean;
  pendingMessage: string | null;
  /** Partial assistant text for the in-progress bubble. */
  streamingText: string;
  stagedOrder: StagedOrder | null;
  /** Terminal snapshots of confirmed orders so old confirmation cards render
   *  correctly after restarts. */
  placedOrders: Record<string, StagedOrder>;
  chatTip: ChatTip;
  chatAddressId: string | null;
  /** Messages that arrived while the sheet was closed — badge on the FAB. */
  unread: number;

  open: () => void;
  close: () => void;
  configure: (email: string | null) => Promise<void>;
  restoreTranscript: (messages: GoerMessage[], apiMessages: ApiMessage[]) => void;
  appendMessage: (msg: GoerMessage) => void;
  appendApiMessage: (msg: ApiMessage) => void;
  setStreaming: (streaming: boolean) => void;
  setStreamingText: (text: string) => void;
  setMode: (mode: 'llm' | 'fallback') => void;
  setActiveAgent: (agent: GoerAgentId, announce?: boolean) => void;
  setChatTip: (tip: ChatTip) => void;
  setChatAddressId: (id: string | null) => void;
  /** Snapshots the live cart + tip + address into a StagedOrder and shows the
   *  confirmation card. Never places the order. */
  stageOrder: () => { ok: true; staged: StagedOrder } | { ok: false; error: string };
  /** Explicit confirmation only; typed chat may publish the returned reply itself. */
  confirmStagedOrder: (renderText?: boolean, expectedCheckoutId?: string) => Promise<string>;
  clearChat: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let ownerGeneration = 0;
export const goerOwnerGeneration = () => ownerGeneration;

function schedulePersist(get: () => GoerState) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    const s = get();
    if (!s.ownerEmail) return;
    const snapshot: PersistedGoerChat = {
      uiMessages: s.uiMessages.slice(-MAX_UI_MESSAGES),
      apiMessages: s.apiMessages.slice(-MAX_API_MESSAGES),
      activeAgent: s.activeAgent,
      placedOrders: s.placedOrders,
      chatTip: s.chatTip,
      chatAddressId: s.chatAddressId,
    };
    void saveGoerChat(s.ownerEmail, snapshot);
  }, 500);
}

/**
 * Trims API history to the cap.
 *
 * Every entry is a plain text turn now that the agent loop is server-side, so
 * this is a slice — the old version also had to avoid orphaning a `tool_result`
 * whose `tool_use` had fallen off the front, which the wire format no longer
 * has. `sanitizeApiMessages` handles chats persisted under that older format.
 */
export function trimApiMessages(messages: ApiMessage[]): ApiMessage[] {
  return sanitizeApiMessages(messages).slice(-MAX_API_MESSAGES);
}

/** Drops anything that isn't a plain text turn — chats persisted before the
 *  backend took over the loop hold Anthropic content-block arrays. */
export function sanitizeApiMessages(messages: unknown): ApiMessage[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (m): m is ApiMessage =>
      Boolean(m) &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.trim().length > 0,
  );
}

export const useGoerStore = create<GoerState>((set, get) => ({
  ownerEmail: null,
  isOpen: false,
  mode: isGoerLLMConfigured ? 'llm' : 'fallback',
  activeAgent: 'concierge',
  uiMessages: [],
  apiMessages: [],
  isStreaming: false,
  isHistoryLoading: false,
  pendingMessage: null,
  streamingText: '',
  stagedOrder: null,
  placedOrders: {},
  chatTip: DEFAULT_TIP,
  chatAddressId: null,
  unread: 0,

  open: () => {
    const s = get();
    const seeded: GoerMessage[] = [];
    if (s.uiMessages.length === 0) {
      const firstName = useAuthStore.getState().currentUser?.firstName;
      seeded.push(
        goerMsg({
          kind: 'text',
          role: 'assistant',
          agent: 'concierge',
          text: `Hey${firstName ? ` ${firstName}` : ''}! I'm Goer — I can help you browse the menu and edit your cart. Use the app's checkout to confirm an order. What are you craving?`,
        }),
        goerMsg({ kind: 'quick_replies', options: DEFAULT_QUICK_REPLIES }),
      );
    }
    set({ isOpen: true, unread: 0, uiMessages: [...s.uiMessages, ...seeded] });
    if (seeded.length > 0) schedulePersist(get);
  },

  close: () => set({ isOpen: false }),

  configure: async (email) => {
    const epoch = ++ownerGeneration;
    set({ ownerEmail: email, uiMessages: [], apiMessages: [], placedOrders: {}, stagedOrder: null,
      isOpen: false, isStreaming: false, isHistoryLoading: false, pendingMessage: null, streamingText: '', unread: 0 });
    if (persistTimer) clearTimeout(persistTimer);
    if (!email) {
      set({
        ownerEmail: null,
        isOpen: false,
        uiMessages: [],
        apiMessages: [],
        activeAgent: 'concierge',
        stagedOrder: null,
        placedOrders: {},
        chatTip: DEFAULT_TIP,
        chatAddressId: null,
        unread: 0,
        isStreaming: false,
        streamingText: '',
        mode: isGoerLLMConfigured ? 'llm' : 'fallback',
      });
      return;
    }
    const authenticated = serverCartEnabled && Boolean(process.env.EXPO_PUBLIC_GOER_API_URL);
    // Email-only legacy caches are not an authenticated history authority.
    const saved = authenticated ? null : await loadGoerChat(email).catch(() => null);
    if (epoch !== ownerGeneration) return;
    set({
      ownerEmail: email,
      uiMessages: saved?.uiMessages ?? [],
      apiMessages: sanitizeApiMessages(saved?.apiMessages),
      activeAgent: saved?.activeAgent ?? 'concierge',
      // A staged-but-unconfirmed order does not survive restarts; its card
      // renders as expired via placedOrders lookup miss.
      stagedOrder: null,
      placedOrders: saved?.placedOrders ?? {},
      chatTip: saved?.chatTip ?? DEFAULT_TIP,
      chatAddressId: saved?.chatAddressId ?? null,
      unread: 0,
      isStreaming: false,
      streamingText: '',
      mode: authenticated ? 'llm' : isGoerLLMConfigured ? 'llm' : 'fallback',
    });
    if (authenticated) {
      try {
        const module = await import('./authenticatedClient');
        if (epoch === ownerGeneration) await module.restoreAuthenticatedConversation();
      } catch {
        if (epoch === ownerGeneration) get().appendMessage(goerMsg({ kind: 'system_note',
          text: 'Saved history is unavailable. Open History to retry after checking sign-in and database setup.' }));
      }
    }
  },

  restoreTranscript: (messages, apiMessages) => {
    set({ uiMessages: messages.slice(-MAX_UI_MESSAGES), apiMessages: trimApiMessages(apiMessages),
      stagedOrder: null, unread: 0, activeAgent: messages.at(-1)?.agent ?? 'concierge' });
    schedulePersist(get);
  },

  appendMessage: (msg) => {
    if (get().uiMessages.some(existing => existing.id === msg.id)) return;
    const isOwnMessage = msg.kind === 'text' && msg.role === 'user';
    set((s) => ({
      uiMessages: [...s.uiMessages, msg].slice(-MAX_UI_MESSAGES),
      unread: s.isOpen || isOwnMessage ? s.unread : s.unread + 1,
    }));
    schedulePersist(get);
  },

  appendApiMessage: (msg) => {
    set((s) => ({ apiMessages: trimApiMessages([...s.apiMessages, msg]) }));
    schedulePersist(get);
  },

  setStreaming: (isStreaming) => set({ isStreaming, ...(isStreaming ? {} : { streamingText: '' }) }),
  setStreamingText: (streamingText) => set({ streamingText }),
  setMode: (mode) => set({ mode }),

  setActiveAgent: (agent, announce = false) => {
    const from = get().activeAgent;
    if (from === agent) return;
    set({ activeAgent: agent });
    if (announce) get().appendMessage(goerMsg({ kind: 'agent_handoff', from, to: agent }));
    schedulePersist(get);
  },

  setChatTip: (chatTip) => {
    const staged = get().stagedOrder;
    if (staged?.status === 'placing') return;
    set({ chatTip, stagedOrder: staged ? { ...staged, status: 'stale' } : null });
    schedulePersist(get);
  },

  setChatAddressId: (chatAddressId) => {
    const staged = get().stagedOrder;
    if (staged?.status === 'placing') return;
    set({ chatAddressId, stagedOrder: staged ? { ...staged, status: 'stale' } : null });
    schedulePersist(get);
  },

  stageOrder: () => {
    const cart = useCartStore.getState();
    if (cart.lines.length === 0) return { ok: false, error: 'The cart is empty.' };
    if (serverCartEnabled && (cart.busy || cart.pending || cart.revision === null)) {
      return { ok: false, error: 'Load and reconcile your signed-in cart before confirming checkout.' };
    }

    const { chatTip, chatAddressId } = get();
    const addressStore = useAddressStore.getState();
    if (serverCartEnabled && (!get().ownerEmail || cart.ownerEmail !== get().ownerEmail
        || addressStore.ownerEmail !== get().ownerEmail
        || useAuthStore.getState().currentUser?.email !== get().ownerEmail)) {
      return { ok: false, error: 'Wait for your signed-in cart and delivery addresses to finish loading.' };
    }
    const address = chatAddressId
      ? addressStore.allAddresses.find((a) => a.id === chatAddressId) ?? addressStore.defaultAddress
      : addressStore.defaultAddress;
    // Same gate as the Cart screen: a checkout needs a verified delivery
    // location, not just any saved string.
    const locationProblem = deliveryLocationProblem(address ?? null);
    if (!address || locationProblem) {
      return {
        ok: false,
        error: `${locationProblem} Type "deliver to <street address>" or "addresses" to choose a verified address here in chat.`,
      };
    }

    const subtotal = round2(cart.subtotal());
    const deliveryFee = cart.deliveryFee();
    const tip = resolveTip(chatTip, subtotal);
    const staged: StagedOrder = {
      id: Crypto.randomUUID(),
      status: 'staged',
      lines: cart.lines,
      subtotal,
      deliveryFee,
      tip,
      total: round2(subtotal + deliveryFee + tip),
      restaurantID: cart.restaurantID,
      address,
      cartHash: computeCartHash(cart.lines),
      cartRevision: cart.revision ?? undefined,
    };
    set({ stagedOrder: staged });
    get().appendMessage(goerMsg({ kind: 'order_confirmation', stagedOrderID: staged.id }));
    return { ok: true, staged };
  },

  confirmStagedOrder: async (renderText = true, expectedCheckoutId) => {
    const epoch = ownerGeneration;
    const staged = get().stagedOrder;
    const reply = (text: string) => {
      if (renderText && ownerGeneration === epoch) get().appendMessage(goerMsg({ kind: 'system_note', text }));
      return text;
    };
    if (!staged || staged.status !== 'staged') return reply('No current checkout is ready. Type "checkout" to review your order first.');

    if (computeCartHash(useCartStore.getState().lines) !== staged.cartHash
        || (serverCartEnabled && staged.cartRevision !== useCartStore.getState().revision)) {
      set({ stagedOrder: { ...staged, status: 'stale' } });
      return reply('Your cart changed after this summary was made. Type "checkout" for an updated total.');
    }

    const owner = get().ownerEmail;
    set({ stagedOrder: { ...staged, status: 'placing' } });
    const result = await placeOrder({
      lines: staged.lines,
      subtotal: staged.subtotal,
      deliveryFee: staged.deliveryFee,
      tip: staged.tip,
      total: staged.total,
      restaurantID: staged.restaurantID,
      deliveryAddress: staged.address,
      customer: useAuthStore.getState().currentUser,
      cartRevision: staged.cartRevision,
      expectedCheckoutId,
    });
    const outcomeText = result.ok
      ? (result.warning ? `Payment confirmed for order ${result.orderId}. ${result.warning}`
        : `Order placed! Reference: ${result.orderId}. Your payment is confirmed.`)
      : (result.canceled ? 'Payment canceled. Your cart is still here. Type "checkout" when you are ready.'
        : `Checkout needs attention: ${result.error}. Do not start another order if payment may be pending.`);
    // The original request still needs its real receipt even when its UI owner
    // changed. Never write that result into a different account's active store.
    if (ownerGeneration !== epoch || get().ownerEmail !== owner) return outcomeText;

    if (!result.ok) {
      // Re-staging (not discarding) means the confirmation card stays usable,
      // so a declined card or a dismissed sheet can just be retried.
      set({ stagedOrder: { ...staged, status: 'staged' } });
      return reply(outcomeText);
    }

    const placed: StagedOrder = { ...staged, status: 'placed' };
    set((s) => ({
      stagedOrder: null,
      placedOrders: { ...s.placedOrders, [placed.id]: placed },
    }));

    const confirmation = outcomeText;
    if (!renderText) return confirmation;
    reply(confirmation);
    const record = useOrdersStore.getState().orders[0];
    get().appendMessage(
      goerMsg({
        kind: 'order_status',
        agent: 'tracker',
        info: {
          orderNumber: null,
          status: record?.status ?? 'Placed',
          etaMinutes: null,
          placedAt: record?.placedAt ?? new Date().toISOString(),
          restaurantName: record?.restaurantName ?? 'Restaurant',
          totalCents: record?.totalCents ?? Math.round(placed.total * 100),
          driverAccepted: false,
        },
      }),
    );
    get().setActiveAgent('tracker', true);
    // Give the model the ground truth for the rest of the conversation.
    get().appendApiMessage({
      role: 'user',
      content: `[system event] ${confirmation}`,
    });
    return confirmation;
  },

  clearChat: () => {
    if (get().isStreaming || get().isHistoryLoading || get().pendingMessage) return;
    const epoch = ownerGeneration;
    const owner = get().ownerEmail;
    // Acquire synchronously: sending or restoring history must not race a reset.
    set({ isHistoryLoading: true });
    const clear = () => {
      if (ownerGeneration !== epoch) return;
      set({ uiMessages: [], apiMessages: [], activeAgent: 'concierge', stagedOrder: null,
        chatTip: DEFAULT_TIP, streamingText: '', isStreaming: false, unread: 0 });
      schedulePersist(get);
    };
    if (serverCartEnabled && process.env.EXPO_PUBLIC_GOER_API_URL && owner) {
      void import('./authenticatedClient').then(module => module.resetAuthenticatedConversation(owner)).then(clear)
        .catch(error => { if (ownerGeneration === epoch) get().appendMessage(goerMsg({ kind: 'system_note', text: error.message })); })
        .finally(() => { if (ownerGeneration === epoch) set({ isHistoryLoading: false }); });
    } else {
      clear();
      if (ownerGeneration === epoch) set({ isHistoryLoading: false });
    }
  },
}));
