import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { presentLocalNotification } from '../lib/notifications';
import { useAuthStore } from './authStore';

/** How far a delivery has progressed, mirrored from the driver onto the shared
 *  orders row. 'available' never reaches the customer as a live order. */
export type DeliveryStatus = 'available' | 'accepted' | 'picked_up' | 'delivered';

/** One of the customer's in-flight orders, shown as a live tracking card. */
export interface OrderTrackingItem {
  id: string;
  orderNumber: string;
  etaMinutes: number | null;
  /** The driver's uid — the other participant of this order's chat thread. */
  driverId: string;
  deliveryStatus: DeliveryStatus;
  acceptedAt: string;
}

/** Lower/upper bound of the delivery window shown to the customer, derived from
 *  the single ETA the driver commits to (45 → "40–50 min"). */
export function etaWindow(etaMinutes: number): { min: number; max: number } {
  return { min: Math.max(5, etaMinutes - 5), max: etaMinutes + 5 };
}

/** In-app alert (with sound) fired when an order crosses into a new delivery
 *  milestone — the local counterpart to the backend's remote push, so the
 *  customer hears progress in Expo Go / simulators too. `available` never
 *  alerts (that's the pre-driver state handled by usePendingOrders). */
const STATUS_ALERT: Partial<
  Record<DeliveryStatus, { title: string; body: (orderNumber: string, eta: number | null) => string }>
> = {
  accepted: {
    title: 'A driver accepted your order! 🎉',
    body: (n, eta) => {
      if (eta === null) return `${n} — your driver is heading to the restaurant.`;
      const { min, max } = etaWindow(eta);
      return `${n} — your driver is heading to the restaurant, arriving in about ${min}–${max} min.`;
    },
  },
  picked_up: {
    title: 'Your order is on the way! 🛵',
    body: (n) => `${n} has been picked up and is heading to you.`,
  },
  delivered: {
    title: 'Your order has arrived! 🎉',
    body: (n) => `${n} was delivered to your drop-off spot. Enjoy!`,
  },
};

/** Monotonic suffix so every subscription gets a fresh channel topic. */
let channelSeq = 0;

interface OrderRow {
  id: string;
  order_number: string;
  eta_minutes: number | null;
  accepted_by: string | null;
  accepted_at: string | null;
  delivery_status: string | null;
}

function toItem(row: OrderRow): OrderTrackingItem | null {
  if (!row.accepted_by) return null;
  return {
    id: row.id,
    orderNumber: row.order_number,
    etaMinutes: row.eta_minutes,
    driverId: row.accepted_by,
    deliveryStatus: (row.delivery_status as DeliveryStatus) ?? 'accepted',
    acceptedAt: row.accepted_at ?? new Date().toISOString(),
  };
}

/**
 * Watches ALL of the signed-in customer's in-flight orders on the shared
 * dispatch backend and returns them as live tracking cards — the moment a
 * driver claims one (accepted_by set), and every time that driver advances it
 * (picked_up → delivered, mirrored onto the orders row). Delivered orders drop
 * off the list. Supports several concurrent orders so the customer can message
 * each order's driver independently.
 *
 * No-op (empty) in demo mode or when signed out — the tracker simply shows
 * nothing.
 */
export function useOrderTracking(): {
  orders: OrderTrackingItem[];
  dismiss: (id: string) => void;
} {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [orders, setOrders] = useState<OrderTrackingItem[]>([]);
  const dismissedRef = useRef<Set<string>>(new Set());
  // Last delivery_status seen per order, so we only alert on genuine forward
  // transitions. `readyRef` gates out the initial backfill (which would
  // otherwise fire a burst of alerts for already-in-flight orders on launch).
  const lastStatusRef = useRef<Map<string, DeliveryStatus>>(new Map());
  const readyRef = useRef(false);

  const upsert = useCallback((row: OrderRow) => {
    const item = toItem(row);
    if (!item) return;

    const prevStatus = lastStatusRef.current.get(item.id);
    lastStatusRef.current.set(item.id, item.deliveryStatus);

    if (!dismissedRef.current.has(item.id)) {
      setOrders((prev) => {
        // Once delivered, remove it from the live stack.
        const withoutThis = prev.filter((o) => o.id !== item.id);
        if (item.deliveryStatus === 'delivered') return withoutThis;
        const next = [...withoutThis, item];
        next.sort((a, b) => (a.acceptedAt < b.acceptedAt ? 1 : -1));
        return next;
      });

      // Alert only on a real change, and never for the backfill pass.
      if (readyRef.current && prevStatus !== item.deliveryStatus) {
        const alert = STATUS_ALERT[item.deliveryStatus];
        if (alert) {
          void presentLocalNotification(
            alert.title,
            alert.body(item.orderNumber, item.etaMinutes),
            { orderId: item.id, kind: `order_${item.deliveryStatus}` },
          );
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !isLoggedIn) {
      setOrders([]);
      return;
    }
    const sb = supabase;
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let foreground: ReturnType<typeof AppState.addEventListener> | null = null;
    // Keep the (re)subscription's backfill pass silent even across remounts.
    readyRef.current = false;

    (async () => {
      const { data: userData } = await sb.auth.getUser();
      const uid = userData.user?.id;
      if (!uid || cancelled) return;

      // Catch orders accepted/progressed while the app was backgrounded: every
      // claimed, not-yet-delivered order from the last few hours.
      const refresh = async () => {
        const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        const { data, error } = await sb.from('orders')
          .select('id, order_number, eta_minutes, accepted_by, accepted_at, delivery_status')
          .eq('customer_id', uid).not('accepted_by', 'is', null)
          .gte('accepted_at', since).order('accepted_at', { ascending: false });
        if (cancelled || error) return;
        // Include delivered rows so polling can remove completed tracking cards.
        (data ?? []).forEach((row) => upsert(row as OrderRow));
        readyRef.current = true;
      };
      await refresh();
      if (cancelled) return;
      poll = setInterval(() => void refresh(), 10000);
      foreground = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });

      // Unique topic per mount: a fixed name hands back a still-subscribed
      // channel on quick remount and .on() then throws.
      channel = sb
        .channel(`customer-orders-${++channelSeq}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter: `customer_id=eq.${uid}` },
          (payload) => upsert(payload.new as OrderRow),
        )
        .subscribe();
      if (cancelled) {
        sb.removeChannel(channel);
        channel = null;
      }
    })();

    return () => {
      cancelled = true;
      if (poll) clearInterval(poll);
      foreground?.remove();
      if (channel) sb.removeChannel(channel);
    };
  }, [isLoggedIn, upsert]);

  const dismiss = useCallback((id: string) => {
    dismissedRef.current.add(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  return { orders, dismiss };
}
