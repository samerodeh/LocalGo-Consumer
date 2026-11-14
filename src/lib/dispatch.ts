import { authHeaders } from './authHeaders';
// Bridges a placed consumer order to the driver dashboard through the
// Python/FastAPI backend (backend/, POST /orders) — the server validates the
// delivery location again, computes the item summary, inserts the shared
// `orders` row, and alerts the drivers. This stays a one-way, best-effort
// side-effect: it never throws, so a missing backend or a network failure can
// never break checkout.
import * as Crypto from 'expo-crypto';
import type { Address, CartLine } from '../types';
import { API_URL, isBackendConfigured } from './api';
import { cartLineDisplayName } from './cartLine';

/** True only when EXPO_PUBLIC_API_URL is set — mirrors the old edge-function gate. */
export const isDispatchConfigured = isBackendConfigured;

export interface DispatchOrderInput {
  lines: CartLine[];
  subtotal: number;
  deliveryFee: number;
  tip: number;
  total: number;
  restaurantName: string;
  restaurantAddress: string;
  customerName: string;
  deliveryAddress: Address | null;
  /** Supabase Auth uid of the customer placing the order, so a driver who
   *  accepts it can be tied back to this account for the "on its way" message.
   *  Null when the consumer isn't signed in against the backend. */
  customerId: string | null;
}

/**
 * Publishes a placed order to the FastAPI backend. Returns the new order's id
 * so the consumer can track it, or null on any failure. Swallows all errors —
 * the caller's local order record is the source of truth.
 */
export async function publishOrderToDispatch(
  input: DispatchOrderInput,
): Promise<string | null> {
  if (!API_URL) return null;

  const { lines, deliveryAddress } = input;

  const dropoff = [deliveryAddress?.addressLine, deliveryAddress?.apartmentSuite]
    .filter((part) => part && part.trim().length > 0)
    .join(', ');

  // Client-generated id so checkout can reference the order without the
  // backend needing to read the row back.
  const id = Crypto.randomUUID();

  try {
    const res = await fetch(`${API_URL}/orders`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({
        id,
        restaurant_name: input.restaurantName,
        restaurant_address: input.restaurantAddress,
        customer_name: input.customerName,
        customer_id: input.customerId,
        dropoff_address: dropoff,
        latitude: deliveryAddress?.latitude ?? 0,
        longitude: deliveryAddress?.longitude ?? 0,
        delivery_instructions: deliveryAddress?.instructions ?? '',
        delivery_preference: deliveryAddress?.deliveryPreference ?? null,
        entry_code: deliveryAddress?.entryCode ?? '',
        subtotal: input.subtotal,
        delivery_fee: input.deliveryFee,
        tip: input.tip,
        total: input.total,
        items: lines.map((l) => ({ name: cartLineDisplayName(l), quantity: l.quantity })),
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn('[dispatch] order publish failed:', res.status, text.slice(0, 200));
      return null;
    }
    return id;
  } catch (err) {
    console.warn('[dispatch] order publish threw:', err);
    return null;
  }
}

