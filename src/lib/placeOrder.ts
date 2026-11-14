import * as Crypto from 'expo-crypto';
import type { Address, CartLine, StoredUser } from '../types';
import { alTaib, restaurantById } from '../data/restaurants';
import { useCartStore } from '../store/cartStore';
import { useCommerceStore } from '../store/commerceStore';
import { useOrdersStore } from '../store/ordersStore';
import { publishOrderToDispatch } from './dispatch';
import { deliveryLocationProblem } from './deliveryLocation';
import { checkoutCart } from './consumerApi';
import type { CheckoutQuote, FulfillmentMode } from '../types/commerce';
import { supabase } from './supabase';

/** Everything checkout needs, snapshotted by the caller before the cart mutates. */
export interface PlaceOrderInput {
  lines: CartLine[];
  subtotal: number;
  deliveryFee: number;
  tip: number;
  total: number;
  restaurantID: string | null;
  deliveryAddress: Address | null;
  customer: StoredUser | null;
  mode?: FulfillmentMode;
  quote?: CheckoutQuote;
  checkoutId?: string;
}

export type PlaceOrderResult =
  { ok: true; orderId?: string; mode?: FulfillmentMode } | { ok: false; error: string };

/**
 * The single checkout pipeline for the Cart screen:
 * simulated payment, acknowledged driver dispatch, a local order record,
 * then cart clear. Uses
 * `getState()` so it's callable outside React components.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  // This development flow simulates payment.
  // Never report a successful purchase in a release build until checkout is
  // backed by verified payment and a durable server-side order.
  if (!__DEV__) {
    return { ok: false, error: 'Ordering is currently unavailable. No payment was taken.' };
  }

  const { lines, subtotal, deliveryFee, tip, total, deliveryAddress, customer } = input;
  if (lines.length === 0) return { ok: false, error: 'Your cart is empty.' };

  // Hard gate on the Cart screen: no order leaves the device
  // without a verified delivery location.
  const locationProblem = input.mode === 'pickup' ? null : deliveryLocationProblem(deliveryAddress);
  if (locationProblem) return { ok: false, error: locationProblem };

  const rid = input.restaurantID ?? alTaib.id;
  const restaurant =
    useCommerceStore.getState().merchants.find((m) => m.id === rid) ?? restaurantById(rid);
  const restaurantName = restaurant?.name ?? rid;

  try {
    if (input.quote) {
      const receipt = await checkoutCart({
        id: input.checkoutId ?? Crypto.randomUUID(),
        lines,
        merchantId: rid,
        mode: input.mode ?? 'delivery',
        quote: input.quote,
        address: deliveryAddress,
        customerName: customer
          ? `${customer.firstName} ${customer.lastName}`.trim()
          : 'LocalGO Customer',
      });
      await useOrdersStore.getState().record({
        lines,
        subtotal: receipt.quote.subtotalCents / 100,
        deliveryFee: receipt.quote.deliveryFeeCents / 100,
        tip: receipt.quote.tipCents / 100,
        total: receipt.quote.totalCents / 100,
        restaurantID: rid,
        restaurantName,
        deliveryAddress: input.mode === 'pickup' ? null : deliveryAddress,
        paymentIntentID: `pi_sim_${receipt.id}`,
      });
      useCartStore.getState().clear();
      return { ok: true, orderId: receipt.id, mode: input.mode ?? 'delivery' };
    }
    if (input.mode === 'pickup')
      return { ok: false, error: 'Please refresh your bag to confirm pickup pricing.' };
    // Simulated authorize → capture (the SwiftUI app's PaymentService, minus the network).
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Tie the dispatched order to this signed-in customer so the driver who
    // accepts it can message them back (see useOrderTracking).
    const { data: authData } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

    // Do not clear the cart or report success until dispatch acknowledges the order.
    const dispatchId = await publishOrderToDispatch({
      lines,
      subtotal,
      deliveryFee,
      tip,
      total,
      restaurantName,
      restaurantAddress: restaurant?.address ?? '',
      customerName: customer
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : 'LocalGO Customer',
      deliveryAddress,
      customerId: authData.user?.id ?? null,
    });

    if (!dispatchId) {
      return {
        ok: false,
        error: 'Your order could not reach dispatch. Please try again. No payment was taken.',
      };
    }

    await useOrdersStore.getState().record({
      lines,
      subtotal,
      deliveryFee,
      tip,
      total,
      restaurantID: rid,
      restaurantName,
      deliveryAddress,
      paymentIntentID: `pi_sim_${Crypto.randomUUID().slice(0, 12)}`,
    });

    useCartStore.getState().clear();
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong placing your order.',
    };
  }
}
