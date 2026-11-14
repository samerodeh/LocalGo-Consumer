import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { presentLocalNotification } from '../lib/notifications';
import { useAuthStore } from './authStore';

/** How long a placed order can sit unclaimed before we reassure the customer.
 *  Short enough to be visible in a demo; a real driver usually claims within
 *  seconds. */
export const PATIENCE_MS = 60_000;

/** Only surface orders placed in the recent past — an old unaccepted order
 *  isn't something the customer is actively waiting on. */
const LOOKBACK_MS = 30 * 60 * 1000;

/** A just-placed order that no driver has claimed yet. Shown to the customer as
 *  a live "finding you a driver…" card until a driver accepts (at which point
 *  useOrderTracking takes over) — or, once PATIENCE_MS elapses, as the
 *  "please be patient, we're a new business" reassurance. */
export interface PendingOrder {
  id: string;
  orderNumber: string;
  createdAt: string;
  /** Flips true once the order has waited past PATIENCE_MS still unclaimed. */
  patient: boolean;
}

/** Monotonic suffix so every subscription gets a fresh channel topic. */
let channelSeq = 0;

interface PendingRow {
  id: string;
  order_number: string;
  created_at: string;
  accepted_by: string | null;
  delivery_status: string | null;
}

function isPending(row: PendingRow): boolean {
  return !row.accepted_by && (row.delivery_status ?? 'available') === 'available';
}

/**
 * Watches the signed-in customer's just-placed orders that no driver has
 * claimed yet, and drives the "finding you a driver" experience:
 *
 *  - shows each unclaimed order as a live pending card the moment it's placed
 *    (there was previously no live feedback between checkout and a driver
 *    accepting);
 *  - after PATIENCE_MS still unclaimed, flips it to a reassurance state AND
 *    fires a one-time local notification ("please be patient, we're a new
 *    business") so the customer hears it even with the app backgrounded on a
 *    device;
 *  - drops the order the instant a driver claims it — `useOrderTracking` then
 *    shows the normal accepted → delivered timeline.
 *
 * No-op (empty) in demo mode or when signed out.
 */
export function usePendingOrders(): { pending: PendingOrder[] } {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const [pending, setPending] = useState<PendingOrder[]>([]);
  // Orders we've already sent the patience notification for — one per order.
  const notifiedRef = useRef<Set<string>>(new Set());

  const apply = useCallback((row: PendingRow) => {
    setPending((prev) => {
      const without = prev.filter((p) => p.id !== row.id);
      if (!isPending(row)) return without; // claimed / progressed — hand off to tracking
      const existing = prev.find((p) => p.id === row.id);
      const item: PendingOrder = {
        id: row.id,
        orderNumber: row.order_number,
        createdAt: row.created_at,
        patient: existing?.patient ?? false,
      };
      return [...without, item].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !isLoggedIn) {
      setPending([]);
      return;
    }
    const sb = supabase;
    let channel: ReturnType<typeof sb.channel> | null = null;
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | null = null;
    let foreground: ReturnType<typeof AppState.addEventListener> | null = null;

    (async () => {
      const { data: userData } = await sb.auth.getUser();
      const uid = userData.user?.id;
      if (!uid || cancelled) return;

      const refresh = async () => {
        const since = new Date(Date.now() - LOOKBACK_MS).toISOString();
        const { data, error } = await sb.from('orders')
          .select('id, order_number, created_at, accepted_by, delivery_status')
          .eq('customer_id', uid).is('accepted_by', null)
          .gte('created_at', since).order('created_at', { ascending: false });
        if (cancelled || error) return;
        const ids = new Set((data ?? []).map((row) => row.id));
        setPending((previous) => previous.filter((order) => ids.has(order.id)));
        (data ?? []).forEach((row) => apply(row as PendingRow));
      };
      await refresh();
      if (cancelled) return;
      poll = setInterval(() => void refresh(), 10000);
      foreground = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });

      channel = sb
        .channel(`customer-pending-${++channelSeq}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `customer_id=eq.${uid}` },
          (payload) => apply(payload.new as PendingRow),
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
  }, [isLoggedIn, apply]);

  // Ticks the patience timer: once an order has waited past PATIENCE_MS still
  // unclaimed, flip it to the reassurance state and notify once.
  useEffect(() => {
    if (pending.length === 0) return;
    const evaluate = () => {
      setPending((prev) => {
        let changed = false;
        const next = prev.map((p) => {
          if (p.patient) return p;
          const waited = Date.now() - new Date(p.createdAt).getTime() >= PATIENCE_MS;
          if (!waited) return p;
          changed = true;
          if (!notifiedRef.current.has(p.id)) {
            notifiedRef.current.add(p.id);
            void presentLocalNotification(
              'Thanks for your patience 🙏',
              `We're a new business and still finding a driver for ${p.orderNumber}. Hang tight — someone will grab it shortly!`,
              { orderId: p.id, kind: 'awaiting_driver' },
            );
          }
          return { ...p, patient: true };
        });
        return changed ? next : prev;
      });
    };
    evaluate();
    const interval = setInterval(evaluate, 5000);
    return () => clearInterval(interval);
  }, [pending.length]);

  return { pending };
}
