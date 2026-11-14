import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useTheme } from '../../theme/ThemeContext';
import { BottomSheet } from '../ui/BottomSheet';
import { DisplayText } from '../DisplayText';
import { Badge } from '../ui/Badge';
import LocalMap from '../maps/LocalMap';
import type { MapPoint } from '../maps/types';
import type { ConsumerOrder } from '../../types/commerce';
import { consumerRequest } from '../../lib/consumerApi';
export function ConsumerOrderStack({
  orders,
  refresh,
  initialOrderId,
}: {
  orders: ConsumerOrder[];
  refresh: () => void;
  initialOrderId?: string;
}) {
  const { colors: c } = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (
      initialOrderId &&
      opened.current !== initialOrderId &&
      orders.some((o) => o.id === initialOrderId)
    ) {
      opened.current = initialOrderId;
      setSelected(initialOrderId);
    }
  }, [initialOrderId, orders]);
  const [reviewError, setReviewError] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const order = orders.find((o) => o.id === selected);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!order?.courierLocation) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(timer);
  }, [order?.id, order?.courierLocation?.updatedAt]);
  const active = orders
    .filter((o) => !['completed', 'delivered'].includes(o.status) || !o.reviewed)
    .slice(0, 4);
  const points: MapPoint[] = [];
  if (order) {
    if (order.merchant.latitude != null && order.merchant.longitude != null)
      points.push({
        id: 'store',
        ...(order.merchant as { latitude: number; longitude: number }),
        kind: 'store',
        label: order.merchantName,
      });
    if (order.dropoff)
      points.push({ id: 'home', ...order.dropoff, kind: 'destination', label: 'Delivery address' });
    if (order.courierLocation)
      points.push({
        id: 'driver',
        ...order.courierLocation,
        kind: 'courier',
        live: now - new Date(order.courierLocation.updatedAt).getTime() <= 90000,
        label: 'Your courier',
      });
  }
  const stages =
    order?.mode === 'pickup'
      ? ['placed', 'preparing', 'ready', 'completed']
      : ['available', 'accepted', 'picked_up', 'delivered'];
  const labels =
    order?.mode === 'pickup'
      ? ['Received', 'Preparing', 'Ready', 'Collected']
      : ['Received', 'Accepted', 'On the way', 'Arrived'];
  const current = order ? Math.max(0, stages.indexOf(order.status)) : 0;
  return (
    <>
      {active.map((o) => (
        <Pressable
          key={o.id}
          accessibilityRole="button"
          accessibilityLabel={`Track ${o.merchantName} order`}
          onPress={() => setSelected(o.id)}
          style={{
            marginHorizontal: 20,
            marginTop: 14,
            padding: 18,
            borderRadius: 20,
            backgroundColor: c.white,
            borderWidth: 1,
            borderColor: c.gray200,
            flexDirection: 'row',
            gap: 14,
            alignItems: 'center',
          }}
        >
          <View style={{ padding: 12, borderRadius: 16, backgroundColor: c.accentSoft }}>
            <Ionicons
              name={o.mode === 'pickup' ? 'bag-handle-outline' : 'bicycle-outline'}
              size={24}
              color={c.accentInk}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: c.navy, fontSize: 15, fontWeight: '800' }}>{o.merchantName}</Text>
            <Text style={{ color: c.textLight, fontSize: 12 }}>
              {statusLabel(o)} · {o.orderNumber}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.navy} />
        </Pressable>
      ))}
      <BottomSheet
        visible={Boolean(order)}
        onClose={() => setSelected(null)}
        title={order ? statusLabel(order) : 'Your order'}
        subtitle={order ? `${order.merchantName} · ${order.orderNumber}` : undefined}
      >
        {order ? (
          <>
            <View style={{ gap: 12 }}>
              <Badge
                label={order.mode === 'pickup' ? 'PICKUP ORDER' : 'DELIVERY ORDER'}
                tone="accent"
              />
              {points.length ? (
                <LocalMap
                  points={points}
                  label="Your store, delivery destination and last shared courier position"
                />
              ) : null}
              {order.mode === 'delivery' ? (
                <Text style={{ color: c.textLight, fontSize: 12, lineHeight: 19 }}>
                  {order.courierLocation
                    ? `${now - new Date(order.courierLocation.updatedAt).getTime() > 90000 ? 'Location sharing paused. Last update' : 'Location updated'} ${new Date(order.courierLocation.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
                    : 'Your courier’s location will appear when they share it.'}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 6, marginVertical: 12 }}>
                {stages.map((s, i) => (
                  <View key={s} style={{ flex: 1, gap: 9 }}>
                    <View
                      style={{
                        height: 5,
                        borderRadius: 3,
                        backgroundColor: i <= current ? c.orange : c.gray200,
                      }}
                    />
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: '700',
                        color: i <= current ? c.navy : c.textLight,
                      }}
                    >
                      {labels[i]}
                    </Text>
                  </View>
                ))}
              </View>
              {order.status === 'ready' ? (
                <Text style={{ fontSize: 16, lineHeight: 24, color: c.navy }}>
                  Your order is ready. Head to {order.merchantName} and show your order number at
                  collection.
                </Text>
              ) : null}
              {order.mode === 'delivery' && ['accepted', 'picked_up'].includes(order.status) ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setSelected(null);
                    router.push({ pathname: '/chat', params: { orderId: order.id } });
                  }}
                  style={{
                    backgroundColor: c.brandNavy,
                    padding: 18,
                    borderRadius: 16,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: c.onBrand, fontWeight: '700' }}>
                    Chat with your courier
                  </Text>
                </Pressable>
              ) : null}
              {['completed', 'delivered'].includes(order.status) && !order.reviewed ? (
                <>
                  <DisplayText size={25}>How was your local favourite?</DisplayText>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    {[1, 2, 3, 4, 5].map((r) => (
                      <Pressable
                        key={r}
                        accessibilityRole="button"
                        accessibilityLabel={`Rate ${r} out of 5`}
                        disabled={reviewBusy}
                        onPress={async () => {
                          setReviewBusy(true);
                          setReviewError('');
                          try {
                            await consumerRequest(`/orders/${order.id}/review`, { rating: r });
                            setSelected(null);
                            refresh();
                          } catch (e) {
                            setReviewError(
                              e instanceof Error ? e.message : 'Review could not be saved.',
                            );
                          } finally {
                            setReviewBusy(false);
                          }
                        }}
                        style={{ padding: 12 }}
                      >
                        <Ionicons name="star" size={28} color={c.accentInk} />
                      </Pressable>
                    ))}
                  </View>
                  {reviewError ? <Text style={{ color: c.danger }}>{reviewError}</Text> : null}
                </>
              ) : null}
            </View>
          </>
        ) : null}
      </BottomSheet>
    </>
  );
}
function statusLabel(order: ConsumerOrder) {
  return (
    (
      {
        available: 'Finding your courier',
        placed: 'Order received',
        accepted: 'Your courier is heading to the store',
        preparing: 'The store is preparing your order',
        ready: 'Ready for pickup',
        picked_up: 'Your order is on the way',
        completed: 'Collected. Enjoy!',
        delivered: 'Delivered. Enjoy!',
      } as Record<string, string>
    )[order.status] ?? 'Order received'
  );
}
