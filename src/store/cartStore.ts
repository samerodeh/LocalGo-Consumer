import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CartLine, MenuItem } from '../types';
import { menuItemById } from '../data/menu';
import { CartApiError, customerToken, requestCart, serverCartEnabled, validateCart, type CartRequest, type ServerCart } from '../lib/serverCart';

const DELIVERY_FEE = 5;
interface CartState {
  lines: CartLine[];
  restaurantID: string | null;
  ownerEmail: string | null;
  revision: number | null;
  serverSnapshot: ServerCart | null;
  busy: boolean;
  error: string | null;
  pending: CartRequest | null;
  configure: (email: string | null) => Promise<void>;
  refresh: () => Promise<void>;
  retryPending: () => Promise<void>;
  acceptServerCart: (cart: ServerCart) => void;
  mutate: (operation: 'add' | 'set' | 'remove' | 'clear' | 'decrement', productId?: string, quantity?: number) => Promise<void>;
  add: (item: MenuItem, restaurantID?: string) => void;
  decrement: (item: MenuItem) => void;
  removeLine: (itemID: string) => void;
  clear: () => void;
  quantityFor: (itemID: string) => number;
  itemCount: () => number;
  subtotal: () => number;
  deliveryFee: () => number;
  total: () => number;
}

let generation = 0;
let queue: Promise<void> = Promise.resolve();
const pendingKey = (owner: string) => `localgo.server-cart.pending:${owner.toLowerCase()}`;

export const useCartStore = create<CartState>((set, get) => {
  const report = (error: unknown, epoch: number) => {
    if (generation === epoch) set({ error: error instanceof Error ? error.message : 'Cart request failed.' });
  };
  const run = (work: () => Promise<void>): Promise<void> => {
    const epoch = generation;
    const next = queue.then(async () => {
      if (epoch !== generation) return;
      set({ busy: true });
      try { await work(); }
      catch (error) { report(error, epoch); throw error; }
      finally { if (epoch === generation) set({ busy: false }); }
    });
    queue = next.catch(() => {});
    return next;
  };
  const sendPending = async (epoch: number, owner: string, pending: CartRequest) => {
    try {
      const cart = await requestCart(owner, pending);
      await AsyncStorage.removeItem(pendingKey(owner));
      if (epoch !== generation) return;
      set({ pending: null, error: null });
      get().acceptServerCart(cart);
      // A replay can return an old receipt; refresh to include later edits.
      const latest = await requestCart(owner);
      if (epoch === generation) get().acceptServerCart(latest);
    } catch (error) {
      if (error instanceof CartApiError && !error.uncertain) {
        await AsyncStorage.removeItem(pendingKey(owner));
        if (epoch === generation) {
          set({ pending: null });
          try { const latest = await requestCart(owner);
            if (epoch === generation) get().acceptServerCart(latest);
          } catch { /* Keep the error visible. */ }
        }
      }
      throw error;
    }
  };
  return {
    lines: [], restaurantID: null, ownerEmail: null, revision: null, serverSnapshot: null,
    busy: false, error: null, pending: null,
    configure: async (email) => {
      const epoch = ++generation;
      queue = Promise.resolve();
      set({ ownerEmail: email, lines: [], restaurantID: null, revision: null, serverSnapshot: null,
        pending: null, busy: false, error: null });
      if (!serverCartEnabled || !email) return;
      try {
        const saved = await AsyncStorage.getItem(pendingKey(email));
        if (epoch !== generation) return;
        if (saved) {
          const pending = JSON.parse(saved) as CartRequest;
          set({ pending, error: 'A cart change needs reconciliation. Tap Retry pending request.' });
        }
        await get().refresh();
      } catch (error) { report(error, epoch); }
    },
    refresh: async () => {
      if (!serverCartEnabled) return;
      const owner = get().ownerEmail;
      const epoch = generation;
      if (!owner) throw new Error('Sign in before loading the cart.');
      const cart = await requestCart(owner);
      if (epoch === generation) get().acceptServerCart(cart);
    },
    retryPending: () => run(async () => {
      const { ownerEmail, pending } = get();
      if (!ownerEmail || !pending) return;
      await sendPending(generation, ownerEmail, pending);
    }),
    acceptServerCart: (value) => {
      const cart = validateCart(value);
      if (get().revision !== null && cart.revision < get().revision!) return;
      const lines = cart.lines.map(line => ({ quantity: line.quantity, item: {
        ...(menuItemById(line.product_id) ?? { id: line.product_id, category: 'Cart', icon: 'restaurant' as const,
          itemDescription: null, imageURL: null }),
        id: line.product_id, name: line.name, price: line.unit_price_cents / 100,
      } }));
      set({ lines, restaurantID: cart.merchant_id, revision: cart.revision, serverSnapshot: cart });
    },
    mutate: (operation, productId, quantity) => run(async () => {
      const epoch = generation;
      if (!serverCartEnabled) throw new Error('Server cart mode is disabled.');
      const state = get();
      if (!state.ownerEmail || state.revision === null) throw new Error('Load your signed-in cart first.');
      if (state.pending) throw new Error('Reconcile the pending cart request before making another change.');
      if (operation === 'decrement') {
        const current = get().quantityFor(productId ?? '');
        if (!current) return;
        operation = current === 1 ? 'remove' : 'set';
        quantity = current - 1;
      }
      const path = operation === 'add' ? '/v1/cart/lines' : operation === 'clear' ? '/v1/cart/clear'
        : `/v1/cart/lines/${encodeURIComponent(productId ?? '')}`;
      const { userId } = await customerToken(state.ownerEmail);
      if (epoch !== generation) return;
      const pending: CartRequest = { ownerId: userId, method: operation === 'remove' ? 'DELETE' : operation === 'set' ? 'PATCH' : 'POST',
        path, key: Crypto.randomUUID(), body: { cart_revision: state.revision,
          ...(operation === 'add' ? { product_id: productId } : {}),
          ...(operation === 'add' || operation === 'set' ? { quantity } : {}) } };
      // Persist before sending; a restart can reconcile the exact request.
      await AsyncStorage.setItem(pendingKey(state.ownerEmail), JSON.stringify(pending));
      if (epoch !== generation) return;
      set({ pending, error: null });
      await sendPending(epoch, state.ownerEmail, pending);
    }),
    add: (item, restaurantID) => {
      if (serverCartEnabled) { void get().mutate('add', item.id, 1).catch(() => {}); return; }
      set(state => {
        if (restaurantID && state.restaurantID && restaurantID !== state.restaurantID) {
          return { error: 'Clear the cart before switching restaurants.' };
        }
        const exists = state.lines.find(line => line.item.id === item.id);
        return { lines: exists ? state.lines.map(line => line.item.id === item.id ? { ...line, quantity: line.quantity + 1 } : line)
          : [...state.lines, { item, quantity: 1 }], restaurantID: state.restaurantID ?? restaurantID ?? null };
      });
    },
    decrement: (item) => {
      const quantity = get().quantityFor(item.id);
      if (!quantity) return;
      if (serverCartEnabled) {
        void get().mutate('decrement', item.id).catch(() => {}); return;
      }
      set(state => {
        const lines = state.lines.flatMap(line => line.item.id !== item.id ? [line]
          : line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []);
        return { lines, restaurantID: lines.length ? state.restaurantID : null };
      });
    },
    removeLine: (id) => {
      if (serverCartEnabled) { void get().mutate('remove', id).catch(() => {}); return; }
      set(state => { const lines = state.lines.filter(line => line.item.id !== id);
        return { lines, restaurantID: lines.length ? state.restaurantID : null }; });
    },
    clear: () => {
      if (serverCartEnabled) { void get().mutate('clear').catch(() => {}); return; }
      set({ lines: [], restaurantID: null });
    },
    quantityFor: id => get().lines.find(line => line.item.id === id)?.quantity ?? 0,
    itemCount: () => get().lines.reduce((n, line) => n + line.quantity, 0),
    subtotal: () => serverCartEnabled ? (get().serverSnapshot?.subtotal_cents ?? 0) / 100
      : get().lines.reduce((n, line) => n + line.item.price * line.quantity, 0),
    deliveryFee: () => serverCartEnabled ? (get().serverSnapshot?.delivery_fee_cents ?? 0) / 100
      : get().lines.length ? DELIVERY_FEE : 0,
    total: () => serverCartEnabled ? (get().serverSnapshot?.total_cents ?? 0) / 100 : get().subtotal() + get().deliveryFee(),
  };
});
