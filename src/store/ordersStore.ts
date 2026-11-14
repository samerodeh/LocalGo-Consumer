import { create } from 'zustand';
import * as Crypto from 'expo-crypto';
import type { Address, CartLine, OrderRecord, Restaurant } from '../types';
import { loadOrders, saveOrders } from '../lib/storage';
import { restaurantById } from '../data/restaurants';
import { cartLineDisplayName, cartLineUnitPrice } from '../lib/cartLine';

const cents = (dollars: number) => Math.round(dollars * 100);

interface OrdersState {
  ownerEmail: string | null;
  orders: OrderRecord[];
  /** Distinct restaurants the user has ordered from, most-recent first. */
  recentRestaurants: Restaurant[];

  configure: (email: string | null) => Promise<void>;
  record: (input: {
    lines: CartLine[];
    subtotal: number;
    deliveryFee: number;
    tip: number;
    total: number;
    restaurantID: string;
    restaurantName: string;
    deliveryAddress: Address | null;
    paymentIntentID: string;
    discountCents?: number;
    fulfillmentMode?: 'delivery' | 'pickup';
    serverOrderId?: string;
  }) => Promise<void>;
}

function deriveRecent(orders: OrderRecord[]): Restaurant[] {
  const seen = new Set<string>();
  const result: Restaurant[] = [];
  for (const order of orders) {
    if (seen.has(order.restaurantID)) continue;
    seen.add(order.restaurantID);
    const restaurant = restaurantById(order.restaurantID);
    if (restaurant) result.push(restaurant);
  }
  return result;
}

export const useOrdersStore = create<OrdersState>((set, get) => ({
  ownerEmail: null,
  orders: [],
  recentRestaurants: [],

  configure: async (email) => {
    if (!email) {
      set({ ownerEmail: null, orders: [], recentRestaurants: [] });
      return;
    }
    const orders = (await loadOrders(email)).sort(
      (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
    );
    set({ ownerEmail: email, orders, recentRestaurants: deriveRecent(orders) });
  },

  record: async ({
    lines,
    subtotal,
    deliveryFee,
    tip,
    total,
    restaurantID,
    restaurantName,
    deliveryAddress,
    paymentIntentID,
    discountCents,
    fulfillmentMode,
    serverOrderId,
  }) => {
    const email = get().ownerEmail;
    if (!email) return;

    const order: OrderRecord = {
      id: Crypto.randomUUID(),
      ownerEmail: email,
      restaurantID,
      restaurantName,
      placedAt: new Date().toISOString(),
      status: 'Placed',
      currency: 'cad',
      subtotalCents: cents(subtotal),
      deliveryFeeCents: cents(deliveryFee),
      tipCents: cents(tip),
      totalCents: cents(total),
      ...(discountCents !== undefined ? { discountCents } : {}),
      ...(fulfillmentMode ? { fulfillmentMode } : {}),
      ...(serverOrderId ? { serverOrderId } : {}),
      paymentIntentID,
      items: lines.map((line) => ({
        id: Crypto.randomUUID(),
        menuItemID: line.item.id,
        name: cartLineDisplayName(line),
        unitPriceCents: cents(cartLineUnitPrice(line)),
        quantity: line.quantity,
        lineTotalCents: cents(cartLineUnitPrice(line)) * line.quantity,
      })),
      deliveryAddressLine: deliveryAddress?.addressLine ?? '',
      deliveryApartmentSuite: deliveryAddress?.apartmentSuite ?? '',
      deliveryInstructions: deliveryAddress?.instructions ?? '',
      deliveryPreference: deliveryAddress?.deliveryPreference ?? '',
    };

    const orders = [order, ...get().orders];
    await saveOrders(email, orders);
    set({ orders, recentRestaurants: deriveRecent(orders) });
  },
}));
