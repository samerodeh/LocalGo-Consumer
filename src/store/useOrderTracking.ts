import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import type { DeliveryStatus } from '../types';
import { useAuthStore } from './authStore';
import { useOrdersStore } from './ordersStore';

/** How far a delivery has progressed, mirrored from the driver onto the shared
 *  orders row. 'available' never reaches the customer as a live order. */
export type { DeliveryStatus };

/** One of the customer's in-flight orders, shown as a live tracking card. */
export interface OrderTrackingItem {
  id: string;
  orderNumber: string;
  etaMinutes: number;
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
    etaMinutes: row.eta_minutes ?? 45,
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

  const upsert = useCallback((row: OrderRow) => {
    const item = toItem(row);
    if (!item) return;

    // Mirror progress onto the customer's own order history, so the Orders
    // screen is up to date even for a card they've dismissed here. Runs before
    // the dismissed check for exactly that reason.
    useOrdersStore.getState().updateFromServer(item.id, {
      orderNumber: item.orderNumber,
      deliveryStatus: item.deliveryStatus,
    });

    if (dismissedRef.current.has(item.id)) return;
    setOrders((prev) => {
      // Once delivered, remove it from the live stack.
      const withoutThis = prev.filter((o) => o.id !== item.id);
      if (item.deliveryStatus === 'delivered') return withoutThis;
      const next = [...withoutThis, item];
      next.sort((a, b) => (a.acceptedAt < b.acceptedAt ? 1 : -1));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !isLoggedIn) {
      setOrders([]);
      return;
    }
    const sb = supabase;
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;

    (async () => {
      const { data: userData } = await sb.auth.getUser();
      const uid = userData.user?.id;
      if (!uid || cancelled) return;

      // Catch orders accepted/progressed while the app was backgrounded: every
      // claimed, not-yet-delivered order from the last few hours.
      const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data } = await sb
        .from('orders')
        .select('id, order_number, eta_minutes, accepted_by, accepted_at, delivery_status')
        .eq('customer_id', uid)
        .not('accepted_by', 'is', null)
        .neq('delivery_status', 'delivered')
        .gte('accepted_at', since)
        .order('accepted_at', { ascending: false });
      if (cancelled) return;
      (data ?? []).forEach((row) => upsert(row as OrderRow));

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
      if (channel) sb.removeChannel(channel);
    };
  }, [isLoggedIn, upsert]);

  const dismiss = useCallback((id: string) => {
    dismissedRef.current.add(id);
    setOrders((prev) => prev.filter((o) => o.id !== id));
  }, []);

  return { orders, dismiss };
}
