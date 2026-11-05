import type { IoniconName } from '../types';
import type { Address, CartLine } from '../types';

/** The six Goer specialists. One is "active" at a time; the backend's router
 *  picks who answers each turn and the change renders as a handoff divider. */
export type GoerAgentId =
  | 'concierge'
  | 'cart'
  | 'checkout'
  | 'tracker'
  | 'dietary'
  | 'recommendation';

export const GOER_AGENT_IDS: GoerAgentId[] = [
  'concierge',
  'cart',
  'checkout',
  'tracker',
  'dietary',
  'recommendation',
];

/** Display metadata for each agent — used by the badge, typing indicator, and
 *  handoff dividers so users can see which specialist is talking. */
export const AGENT_META: Record<GoerAgentId, { name: string; icon: IoniconName }> = {
  concierge: { name: 'Menu Concierge', icon: 'restaurant' },
  cart: { name: 'Cart Manager', icon: 'cart' },
  checkout: { name: 'Checkout', icon: 'card' },
  tracker: { name: 'Order Tracker', icon: 'bicycle' },
  dietary: { name: 'Dietary Advisor', icon: 'leaf' },
  recommendation: { name: 'Recommendations', icon: 'sparkles' },
};

export function isGoerAgentId(value: unknown): value is GoerAgentId {
  return typeof value === 'string' && (GOER_AGENT_IDS as string[]).includes(value);
}

// MARK: - Chat transport
//
// The agent loop runs on the backend (backend/app/goer/), so the wire format is
// just the conversation plus the app state the agents reason over. Compare the
// previous design, where the app shipped Anthropic tool-use blocks: tools are
// still executed here, but the model never sees them — the server returns the
// calls it wants run.

/** One conversation turn. Plain text both ways. */
export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A tool call the backend wants the client to execute. `tool` names an
 *  executor in `tools/executors.ts`. */
export interface GoerAction {
  tool: string;
  input: Record<string, unknown>;
}

/** The snapshot of on-device state sent with every turn. The cart lives in
 *  zustand, not on the server, so the agents get it this way. */
export interface GoerRequestContext {
  firstName: string;
  languagePreference: string;
  cart: { itemId: string; name: string; quantity: number; unitPrice: number }[];
  restaurantId: string | null;
  subtotal: number;
  deliveryFee: number;
  tip: { kind: 'percent' | 'amount'; value: number };
  addresses: { id: string; label: string; addressLine: string; isDefault: boolean }[];
  selectedAddressId: string | null;
  orders: {
    id: string;
    restaurantName: string;
    status: string;
    placedAt: string;
    totalCents: number;
    items: { itemId: string; name: string; quantity: number; unitPrice: number }[];
  }[];
  dietaryProfile: {
    halal: boolean;
    vegan: boolean;
    vegetarian: boolean;
    allergies: string[];
  };
}

/** SSE frames from `POST /goer/chat/stream`, in the order they arrive. */
export type GoerStreamEvent =
  | { type: 'agent'; agent: GoerAgentId; language: string }
  | { type: 'token'; token: string }
  | { type: 'actions'; actions: GoerAction[] }
  | { type: 'quick_replies'; options: string[] }
  | { type: 'done' }
  | { type: 'error'; error: { message: string } };

// MARK: - Chat state

/** Tip mirrors the Cart screen: a preset % of the subtotal or a custom dollar amount. */
export type ChatTip = { kind: 'percent'; value: number } | { kind: 'amount'; value: number };

/**
 * A snapshot of everything the user is about to order, staged by the Checkout
 * agent. The order is ONLY placed when the user taps Confirm on the card —
 * `cartHash` detects cart edits between staging and confirming.
 */
export interface StagedOrder {
  id: string;
  status: 'staged' | 'placing' | 'placed' | 'stale';
  lines: CartLine[];
  subtotal: number;
  deliveryFee: number;
  tip: number;
  total: number;
  restaurantID: string | null;
  address: Address | null;
  cartHash: string;
}

export interface ServerProduct {
  product_id: string;
  merchant_id: string;
  name: string;
  display_price: string;
  currency: string;
  description?: string;
  image_url?: string | null;
}

export interface CartSummarySnapshot {
  lines: { itemID: string; name: string; quantity: number; unitPrice: number }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
}

export interface OrderStatusInfo {
  orderNumber: string | null;
  status: string;
  etaMinutes: number | null;
  placedAt: string | null;
  restaurantName: string;
  totalCents: number | null;
  driverAccepted: boolean;
}

/** Everything Goer can render in the transcript — text plus rich widgets. */
export type GoerMessage = { id: string; createdAt: string; agent?: GoerAgentId } & (
  | { kind: 'text'; role: 'user' | 'assistant'; text: string }
  | { kind: 'menu_items'; itemIDs: string[] }
  | { kind: 'server_products'; items: ServerProduct[] }
  | { kind: 'cart_summary'; snapshot: CartSummarySnapshot }
  | { kind: 'order_confirmation'; stagedOrderID: string }
  | { kind: 'order_status'; info: OrderStatusInfo }
  | { kind: 'quick_replies'; options: string[] }
  | { kind: 'agent_handoff'; from: GoerAgentId; to: GoerAgentId }
  | { kind: 'system_note'; text: string }
);

/** What a tool executor hands back to whichever brain called it (the backend
 *  agents via `actions`, or the local NLU): text describing the outcome,
 *  optional widgets for the transcript, and an optional agent handoff. */
export interface ToolExecution {
  resultText: string;
  widgets?: GoerMessage[];
  handoffTo?: GoerAgentId;
  isError?: boolean;
}

/** Shape persisted to AsyncStorage under `localgo.goer.<email>`. */
export interface PersistedGoerChat {
  uiMessages: GoerMessage[];
  apiMessages: ApiMessage[];
  activeAgent: GoerAgentId;
  placedOrders: Record<string, StagedOrder>;
  chatTip: ChatTip;
  chatAddressId: string | null;
}
