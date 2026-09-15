import * as Crypto from 'expo-crypto';
import type { Address, CartLine, StoredUser } from '../types';
import { alTaib, restaurantById } from '../data/restaurants';
import { useCartStore } from '../store/cartStore';
import { useOrdersStore } from '../store/ordersStore';
import { publishOrderToDispatch } from './dispatch';
import { deliveryLocationProblem } from './deliveryLocation';
import { isPaymentsConfigured, payForOrder } from './payments';
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
}

export type PlaceOrderResult =
  | {
      ok: true;
      orderId: string;
      /** Paid and recorded, but the driver feed didn't get it. Show this. */
      warning?: string;
    }
  | {
      ok: false;
      error: string;
      /** User dismissed the payment sheet. Nothing was charged; stay quiet. */
      canceled?: boolean;
    };

/**
 * The single checkout pipeline, shared by the Cart screen and Goer's in-chat
 * confirmation card.
 *
 * Order of operations matters and is deliberate:
 *
 *   1. Gate on a verified delivery location (never charge for an undeliverable
 *      order).
 *   2. Charge the card. The backend prices the cart itself — the totals in
 *      `input` are display values and are NOT what gets charged.
 *   3. Only then record the order locally, using the amounts Stripe actually
 *      took.
 *   4. Publish to the driver feed, with retries, because at this point the
 *      customer's money is gone and an order that never reaches a driver is
 *      the worst possible outcome.
 *
 * Uses `getState()` so it's callable outside React components.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { lines, deliveryAddress, customer, tip } = input;
  if (lines.length === 0) return { ok: false, error: 'Your cart is empty.' };

  // Hard gate, shared by the Cart screen and Goer: no order leaves the device
  // without a verified delivery location. Runs before payment on purpose.
  const locationProblem = deliveryLocationProblem(deliveryAddress);
  if (locationProblem) return { ok: false, error: locationProblem };

  const rid = input.restaurantID ?? alTaib.id;
  const restaurant = restaurantById(rid);
  const restaurantName = restaurant?.name ?? rid;

  // Generated up front: it's the Stripe idempotency key, it ties the
  // PaymentIntent to this order server-side, and it's the row's primary key,
  // so a retried dispatch can't create a second order.
  const orderId = Crypto.randomUUID();

  try {
    const { data: sessionData } = supabase
      ? await supabase.auth.getSession()
      : { data: { session: null } };
    const accessToken = sessionData.session?.access_token ?? null;

    // Amounts as charged. Start from the display values and let the server
    // overwrite them with what it actually billed.
    let subtotal = input.subtotal;
    let deliveryFee = input.deliveryFee;
    let tipCharged = tip;
    let total = input.total;
    let paymentIntentID: string;

    if (isPaymentsConfigured) {
      const outcome = await payForOrder({ orderId, lines, tip, accessToken });

      if (outcome.status === 'canceled') {
        return { ok: false, error: 'Payment canceled.', canceled: true };
      }
      if (outcome.status === 'failed') {
        return { ok: false, error: outcome.message };
      }

      paymentIntentID = outcome.paymentIntentId;
      subtotal = outcome.quote.subtotalCents / 100;
      deliveryFee = outcome.quote.deliveryFeeCents / 100;
      tipCharged = outcome.quote.tipCents / 100;
      total = outcome.quote.totalCents / 100;
    } else {
      // Demo mode only — no backend configured, so there is nothing to charge
      // and no real money can be involved. Kept so the app stays fully usable
      // offline, matching how auth and dispatch already degrade. The `demo`
      // prefix makes these records obvious in order history.
      paymentIntentID = `pi_demo_${Crypto.randomUUID().slice(0, 12)}`;
    }

    // Recorded under the SAME id it was paid and dispatched under, so local
    // history, the driver's row, the chat thread, and any push about this order
    // all name one thing. The order number arrives from dispatch below.
    await useOrdersStore.getState().record({
      id: orderId,
      orderNumber: null,
      lines,
      subtotal,
      deliveryFee,
      tip: tipCharged,
      total,
      restaurantID: rid,
      restaurantName,
      deliveryAddress,
      paymentIntentID,
    });

    // Tie the dispatched order to this signed-in customer so the driver who
    // accepts it can message them back (see useOrderTracking).
    const { data: authData } = supabase ? await supabase.auth.getUser() : { data: { user: null } };

    // No longer fire-and-forget. Before payments this was best-effort because
    // a failed dispatch cost nothing; now it means a paid order no driver can
    // see, so it's awaited and retried. The backend treats a repeated id as an
    // idempotent success, so retrying can't double-publish.
    const dispatched = await publishOrderToDispatch({
      orderId,
      paymentIntentID: isPaymentsConfigured ? paymentIntentID : null,
      lines,
      subtotal,
      deliveryFee,
      tip: tipCharged,
      total,
      restaurantName,
      restaurantAddress: restaurant?.address ?? '',
      customerName: customer
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : 'LocalGO Customer',
      deliveryAddress,
      customerId: authData.user?.id ?? null,
    });

    useCartStore.getState().clear();

    // "#LG-1234" — the reference the customer sees on the confirmation screen
    // and in every push about this delivery.
    if (dispatched?.orderNumber) {
      useOrdersStore
        .getState()
        .updateFromServer(orderId, { orderNumber: dispatched.orderNumber });
    }

    if (!dispatched) {
      // Deliberately still `ok`: the charge went through and the order is in
      // local history, so telling the user it failed would be a lie that
      // invites a second payment.
      return {
        ok: true,
        orderId,
        warning:
          "Your payment went through, but we couldn't reach dispatch. Contact support with your order if no driver picks it up.",
      };
    }

    return { ok: true, orderId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Something went wrong placing your order.',
    };
  }
}
