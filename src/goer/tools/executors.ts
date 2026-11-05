import { serverCartEnabled } from '../../lib/serverCart';
import { executeServerCartAction } from './serverCartExecutors';
import type { MenuItem } from '../../types';
import { alTaib } from '../../data/restaurants';
import { useCartStore } from '../../store/cartStore';
import { useOrdersStore } from '../../store/ordersStore';
import { addressDisplayName, useAddressStore } from '../../store/addressStore';
import { supabase } from '../../lib/supabase';
import {
  menuItemById,
  itemsByCategory,
  resolveCategory,
  resolveMenuItem,
} from '../menuIndex';
import { goerMsg, resolveTip, useGoerStore } from '../goerStore';
import { isGoerAgentId } from '../types';
import type { CartSummarySnapshot, GoerAgentId, ToolExecution } from '../types';

const money = (n: number) => `$${n.toFixed(2)}`;

/** The cart is single-restaurant; Goer only sells Al Taib today. */
function cartRestaurantConflict(): string | null {
  const rid = useCartStore.getState().restaurantID;
  if (rid && rid !== alTaib.id) {
    return `The cart already holds items from another restaurant (${rid}). Ask the user if they want to clear it first.`;
  }
  return null;
}

function cartSummarySnapshot(): CartSummarySnapshot {
  const cart = useCartStore.getState();
  return {
    lines: cart.lines.map((l) => ({
      itemID: l.item.id,
      name: l.item.name,
      quantity: l.quantity,
      unitPrice: l.item.price,
    })),
    subtotal: cart.subtotal(),
    deliveryFee: cart.deliveryFee(),
    total: cart.total(),
  };
}

function cartAsText(): string {
  const cart = useCartStore.getState();
  if (cart.lines.length === 0) return 'The cart is empty.';
  const lines = cart.lines
    .map((l) => `${l.quantity}× ${l.item.name} (${money(l.item.price * l.quantity)})`)
    .join(', ');
  return `Cart: ${lines}. Subtotal ${money(cart.subtotal())}, delivery fee ${money(cart.deliveryFee())}.`;
}

/** Resolve an id/query pair to a menu item, or explain why we couldn't. */
function resolveRef(input: {
  item_id?: unknown;
  query?: unknown;
}): { item: MenuItem } | { error: string; candidates?: MenuItem[] } {
  if (typeof input.item_id === 'string' && input.item_id) {
    const item = menuItemById(input.item_id);
    if (item) return { item };
    return { error: `No menu item with id "${input.item_id}".` };
  }
  if (typeof input.query === 'string' && input.query) {
    const res = resolveMenuItem(input.query);
    if (res.kind === 'match') return { item: res.item };
    if (res.kind === 'ambiguous') {
      return {
        error: `"${input.query}" is ambiguous. Candidates: ${res.candidates
          .map((c) => `${c.name} (${c.id}, ${money(c.price)})`)
          .join('; ')}. Ask the user which one they mean.`,
        candidates: res.candidates,
      };
    }
    return { error: `Nothing on the menu matches "${input.query}".` };
  }
  return { error: 'Provide item_id or query.' };
}

type ToolInput = Record<string, unknown>;

/** Like resolveRef, but scoped to what's actually in the cart. */
function resolveCartRef(
  input: ToolInput,
  cartItems: MenuItem[],
): { item: MenuItem } | { error: string } {
  if (typeof input.item_id === 'string' && input.item_id) {
    const item = cartItems.find((i) => i.id === input.item_id);
    return item ? { item } : { error: `"${input.item_id}" isn't in the cart.` };
  }
  if (typeof input.query === 'string' && input.query) {
    const res = resolveMenuItem(input.query, cartItems);
    if (res.kind === 'match') return { item: res.item };
    if (res.kind === 'ambiguous') {
      return {
        error: `Ambiguous within the cart: ${res.candidates.map((c) => c.name).join(', ')}. Ask the user.`,
      };
    }
    return { error: `Nothing in the cart matches "${input.query}".` };
  }
  return { error: 'Provide item_id or query.' };
}

const executors: Record<string, (input: ToolInput) => Promise<ToolExecution> | ToolExecution> = {
  // MARK: Concierge

  show_menu_items: (input) => {
    const ids = Array.isArray(input.item_ids) ? input.item_ids.filter((v): v is string => typeof v === 'string') : [];
    const valid = ids.map((id) => menuItemById(id)).filter((i): i is MenuItem => Boolean(i)).slice(0, 6);
    if (valid.length === 0) return { resultText: 'None of those ids exist on the menu.', isError: true };
    return {
      resultText: `Displayed ${valid.length} item card(s): ${valid.map((i) => `${i.name} ${money(i.price)}`).join(', ')}.`,
      widgets: [goerMsg({ kind: 'menu_items', itemIDs: valid.map((i) => i.id) })],
    };
  },

  show_category: (input) => {
    const cat = typeof input.category === 'string' ? resolveCategory(input.category) : null;
    if (!cat) return { resultText: `Unknown category "${String(input.category)}".`, isError: true };
    const items = itemsByCategory(cat);
    const shown = items.slice(0, 6);
    return {
      resultText: `Displayed ${shown.length} of ${items.length} items in ${cat}: ${shown
        .map((i) => `${i.name} ${money(i.price)}`)
        .join(', ')}${items.length > shown.length ? ` (and ${items.length - shown.length} more)` : ''}.`,
      widgets: [goerMsg({ kind: 'menu_items', itemIDs: shown.map((i) => i.id) })],
    };
  },

  // MARK: Cart

  add_to_cart: (input) => {
    const conflict = cartRestaurantConflict();
    if (conflict) return { resultText: conflict, isError: true };

    const entries = Array.isArray(input.items) ? (input.items as ToolInput[]) : [];
    if (entries.length === 0) return { resultText: 'No items given.', isError: true };

    const added: string[] = [];
    const problems: string[] = [];
    const candidateWidgets: MenuItem[] = [];

    for (const entry of entries) {
      const resolved = resolveRef(entry);
      if ('error' in resolved) {
        problems.push(resolved.error);
        if (resolved.candidates) candidateWidgets.push(...resolved.candidates);
        continue;
      }
      const qty = Math.max(1, Math.min(20, Number(entry.quantity) || 1));
      for (let i = 0; i < qty; i++) useCartStore.getState().add(resolved.item, alTaib.id);
      added.push(`${qty}× ${resolved.item.name}`);
    }

    const widgets =
      candidateWidgets.length > 0
        ? [goerMsg({ kind: 'menu_items', itemIDs: [...new Set(candidateWidgets.map((c) => c.id))].slice(0, 4) })]
        : undefined;

    const parts: string[] = [];
    if (added.length > 0) parts.push(`Added ${added.join(', ')}. ${cartAsText()}`);
    if (problems.length > 0) parts.push(problems.join(' '));
    return { resultText: parts.join(' '), widgets, isError: added.length === 0 };
  },

  remove_from_cart: (input) => {
    const cartItems = useCartStore.getState().lines.map((l) => l.item);
    if (cartItems.length === 0) return { resultText: 'The cart is already empty.', isError: true };
    const resolved = resolveCartRef(input, cartItems);
    if ('error' in resolved) return { resultText: resolved.error, isError: true };
    useCartStore.getState().removeLine(resolved.item.id);
    return { resultText: `Removed ${resolved.item.name}. ${cartAsText()}` };
  },

  set_quantity: (input) => {
    const target = Math.max(0, Math.min(20, Number(input.quantity)));
    if (!Number.isFinite(target)) return { resultText: 'quantity must be a number.', isError: true };

    const cartItems = useCartStore.getState().lines.map((l) => l.item);
    const pool = cartItems.length > 0 ? cartItems : undefined;
    const resolved = resolveRef(input);
    // Prefer a cart-line match when the menu-wide resolution failed or picked
    // something not in the cart while the user clearly meant a cart edit.
    let item: MenuItem | null = 'item' in resolved ? resolved.item : null;
    if (!item && pool && typeof input.query === 'string') {
      const res = resolveMenuItem(input.query, pool);
      if (res.kind === 'match') item = res.item;
    }
    if (!item) return { resultText: 'error' in resolved ? resolved.error : 'Item not found.', isError: true };

    const conflict = cartRestaurantConflict();
    if (conflict && target > 0) return { resultText: conflict, isError: true };

    const store = useCartStore.getState();
    let current = store.quantityFor(item.id);
    while (current < target) {
      store.add(item, alTaib.id);
      current++;
    }
    while (current > target) {
      useCartStore.getState().decrement(item);
      current--;
    }
    return {
      resultText:
        target === 0
          ? `Removed ${item.name}. ${cartAsText()}`
          : `Set ${item.name} to ${target}. ${cartAsText()}`,
    };
  },

  view_cart: () => ({
    resultText: cartAsText(),
    widgets:
      useCartStore.getState().lines.length > 0
        ? [goerMsg({ kind: 'cart_summary', snapshot: cartSummarySnapshot() })]
        : undefined,
  }),

  clear_cart: () => {
    useCartStore.getState().clear();
    return { resultText: 'Cart cleared.' };
  },

  // MARK: Checkout

  get_checkout_state: () => {
    const goer = useGoerStore.getState();
    const cart = useCartStore.getState();
    const subtotal = cart.subtotal();
    const tip = resolveTip(goer.chatTip, subtotal);
    const addressStore = useAddressStore.getState();
    const address = goer.chatAddressId
      ? addressStore.allAddresses.find((a) => a.id === goer.chatAddressId) ?? addressStore.defaultAddress
      : addressStore.defaultAddress;
    const tipLabel =
      goer.chatTip.kind === 'percent' ? `${goer.chatTip.value}% (${money(tip)})` : money(tip);
    return {
      resultText: `${cartAsText()} Tip: ${tipLabel}. Total with fee and tip: ${money(
        subtotal + cart.deliveryFee() + tip,
      )}. Delivery address: ${address ? `${addressDisplayName(address)} — ${address.addressLine}` : 'NONE ON FILE (user must add one via the Address screen before checkout)'}.`,
    };
  },

  set_tip: (input) => {
    const goer = useGoerStore.getState();
    if (typeof input.percent === 'number' && [0, 15, 18, 20, 25].includes(input.percent)) {
      goer.setChatTip({ kind: 'percent', value: input.percent });
      return { resultText: `Tip set to ${input.percent}% of the subtotal.` };
    }
    if (typeof input.amount === 'number' && input.amount >= 0 && input.amount <= 200) {
      goer.setChatTip({ kind: 'amount', value: Math.round(input.amount * 100) / 100 });
      return { resultText: `Tip set to ${money(input.amount)}.` };
    }
    return { resultText: 'Provide percent (0/15/18/20/25) or a dollar amount 0–200.', isError: true };
  },

  list_addresses: () => {
    const { allAddresses } = useAddressStore.getState();
    if (allAddresses.length === 0) {
      return { resultText: 'No saved addresses. The user must add one on the Address screen first.' };
    }
    return {
      resultText: allAddresses
        .map((a) => `${a.id}: ${addressDisplayName(a)} — ${a.addressLine}${a.isDefault ? ' (default)' : ''}`)
        .join('; '),
    };
  },

  select_address: (input) => {
    const id = typeof input.address_id === 'string' ? input.address_id : '';
    const address = useAddressStore.getState().allAddresses.find((a) => a.id === id);
    if (!address) return { resultText: `No address with id "${id}".`, isError: true };
    useGoerStore.getState().setChatAddressId(id);
    return { resultText: `Delivering to ${addressDisplayName(address)} — ${address.addressLine}.` };
  },

  stage_order_confirmation: () => {
    const result = useGoerStore.getState().stageOrder();
    if (!result.ok) return { resultText: result.error, isError: true };
    const s = result.staged;
    return {
      // The widget is appended by stageOrder itself; spell the invariant out
      // for the model so it never claims the order went through.
      resultText: `Confirmation card shown: ${s.lines
        .map((l) => `${l.quantity}× ${l.item.name}`)
        .join(', ')} — subtotal ${money(s.subtotal)}, fee ${money(s.deliveryFee)}, tip ${money(
        s.tip,
      )}, total ${money(s.total)}. The order is NOT placed yet — the user must tap Confirm on the card. Do not claim it was placed.`,
    };
  },

  // MARK: Tracker

  get_active_order: async () => {
    // Live path: the driver app updates the shared orders table when a driver
    // claims the delivery.
    if (supabase) {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      if (uid) {
        const { data } = await supabase
          .from('orders')
          .select('id, order_number, status, eta_minutes, accepted_by, created_at, order_total, restaurant_name')
          .eq('customer_id', uid)
          .order('created_at', { ascending: false })
          .limit(1);
        const row = data?.[0];
        if (row) {
          const accepted = Boolean(row.accepted_by);
          return {
            resultText: `Latest order ${row.order_number}: ${
              accepted ? `a driver accepted it, ETA about ${row.eta_minutes ?? 45} minutes` : 'waiting for a driver'
            } (status: ${row.status}).`,
            widgets: [
              goerMsg({
                kind: 'order_status',
                agent: 'tracker',
                info: {
                  orderNumber: row.order_number,
                  status: accepted ? 'Driver on the way' : 'Waiting for a driver',
                  etaMinutes: row.eta_minutes ?? null,
                  placedAt: row.created_at ?? null,
                  restaurantName: row.restaurant_name ?? 'Al Taib',
                  totalCents: row.order_total != null ? Math.round(Number(row.order_total) * 100) : null,
                  driverAccepted: accepted,
                },
              }),
            ],
          };
        }
      }
    }
    // Local fallback: order history on this device.
    const record = useOrdersStore.getState().orders[0];
    if (!record) return { resultText: 'No orders yet on this account.' };
    return {
      resultText: `Latest order (local record): ${record.restaurantName}, ${record.status}, total ${money(
        record.totalCents / 100,
      )}, placed ${record.placedAt}. Live driver tracking needs a backend sign-in.`,
      widgets: [
        goerMsg({
          kind: 'order_status',
          agent: 'tracker',
          info: {
            orderNumber: null,
            status: record.status,
            etaMinutes: null,
            placedAt: record.placedAt,
            restaurantName: record.restaurantName,
            totalCents: record.totalCents,
            driverAccepted: false,
          },
        }),
      ],
    };
  },

  get_past_orders: (input) => {
    const limit = Math.max(1, Math.min(10, Number(input.limit) || 5));
    const orders = useOrdersStore.getState().orders.slice(0, limit);
    if (orders.length === 0) return { resultText: 'No past orders on this account.' };
    return {
      resultText: orders
        .map(
          (o) =>
            `${o.id}: ${o.restaurantName}, ${new Date(o.placedAt).toLocaleDateString()}, ${o.items.length} line(s), total ${money(o.totalCents / 100)}, ${o.status}`,
        )
        .join('; '),
    };
  },

  get_order_details: (input) => {
    const id = typeof input.order_id === 'string' ? input.order_id : '';
    const order = useOrdersStore.getState().orders.find((o) => o.id === id);
    if (!order) return { resultText: `No order with id "${id}".`, isError: true };
    return {
      resultText: `${order.restaurantName} on ${new Date(order.placedAt).toLocaleString()}: ${order.items
        .map((i) => `${i.quantity}× ${i.name}`)
        .join(', ')}. Subtotal ${money(order.subtotalCents / 100)}, fee ${money(
        order.deliveryFeeCents / 100,
      )}, tip ${money(order.tipCents / 100)}, total ${money(order.totalCents / 100)}. Delivered to ${
        order.deliveryAddressLine || 'n/a'
      }. Status: ${order.status}.`,
    };
  },

  // MARK: Shared

  // Kept for the local NLU and any direct caller; the backend router swaps the
  // active agent itself and reports it in the stream's `agent` frame instead.
  handoff_to_agent: (input) => {
    const target = input.agent as GoerAgentId;
    if (!isGoerAgentId(target)) {
      return { resultText: `Unknown agent "${String(input.agent)}".`, isError: true };
    }
    if (useGoerStore.getState().activeAgent === target) {
      return { resultText: `Already handled by ${target}.` };
    }
    return { resultText: `Transferred to ${target}.`, handoffTo: target };
  },
};

/** Runs one tool call against the live stores. Unknown tools return an error
 *  result (never throw) so a confused model gets feedback instead of a crash. */
export async function executeTool(name: string, input: ToolInput): Promise<ToolExecution> {
  const executor = executors[name];
  if (!executor) return { resultText: `Unknown tool "${name}".`, isError: true };
  try {
    if (serverCartEnabled && ['add_to_cart', 'remove_from_cart', 'set_quantity', 'view_cart', 'clear_cart'].includes(name)) {
      return await executeServerCartAction(name, input ?? {});
    }
    return await executor(input ?? {});
  } catch (err) {
    return {
      resultText: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      isError: true,
    };
  }
}
