import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { presentLocalNotification } from '../lib/notifications';
import { getConsumerOrders } from '../lib/consumerApi';
import { useAuthStore } from './authStore';
import type { ConsumerOrder } from '../types/commerce';
export function useConsumerOrders() {
  const email = useAuthStore((s) => s.currentUser?.email);
  const [orders, setOrders] = useState<ConsumerOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    setOrders([]);
    setError(null);
    if (!email) {
      setLoading(false);
      return;
    }
    let disposed = false,
      inflight = false;
    let controller: AbortController | null = null;
    let hydrated = false;
    const previous = new Map<string, string>();
    const load = async () => {
      if (inflight || AppState.currentState === 'background') return;
      inflight = true;
      controller = new AbortController();
      try {
        const data = await getConsumerOrders(controller.signal);
        if (!disposed) {
          if (hydrated)
            for (const order of data.orders) {
              const before = previous.get(order.id);
              if (
                order.mode === 'pickup' &&
                before &&
                before !== order.status &&
                order.status === 'ready'
              )
                void presentLocalNotification(
                  'Your pickup is ready',
                  `${order.merchantName} has your order ready. Show ${order.orderNumber} at collection.`,
                  { orderId: order.id, kind: 'pickup_ready' },
                );
            }
          data.orders.forEach((order) => previous.set(order.id, order.status));
          hydrated = true;
          setOrders(data.orders);
          setError(null);
        }
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : 'Tracking is unavailable.');
      } finally {
        inflight = false;
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 10000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      disposed = true;
      controller?.abort();
      clearInterval(timer);
      sub.remove();
    };
  }, [email, revision]);
  return { orders, error, loading, refresh };
}
