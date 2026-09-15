import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { radius } from '../theme/theme';
import { useTheme, type ThemePalette } from '../theme/ThemeContext';
import {
  etaWindow,
  type DeliveryStatus,
  type OrderTrackingItem,
} from '../store/useOrderTracking';

/** The customer-visible milestones of a delivery, in order. Each one is also a
 *  push notification, so this timeline is the visual form of the same sequence
 *  the customer gets on their lock screen. */
const STEPS: { key: DeliveryStatus; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'accepted', label: 'Accepted', icon: 'restaurant' },
  { key: 'picked_up', label: 'Picked up', icon: 'bicycle' },
  { key: 'nearby', label: 'Nearby', icon: 'navigate' },
  { key: 'arrived', label: 'At your door', icon: 'home' },
];

const STEP_INDEX: Record<DeliveryStatus, number> = {
  available: -1,
  accepted: 0,
  picked_up: 1,
  nearby: 2,
  arrived: 3,
  // Delivered completes the last step rather than adding a fifth: by the time
  // the driver marks it, the customer has the food in their hands.
  delivered: 3,
};

function headline(status: DeliveryStatus): string {
  switch (status) {
    case 'picked_up':
      return 'Your order is on the way! 🛵';
    case 'nearby':
      return 'Your driver is almost there! 🛵';
    case 'arrived':
      return 'Your driver is here! 🎉';
    case 'delivered':
      return 'Your order has arrived! 🎉';
    default:
      return 'A driver is on the way! 🎉';
  }
}

/** A stack of live tracking cards, one per in-flight order. Each shows a
 *  progress timeline and its own "Chat with driver" button so a customer with
 *  several orders can message each order's driver independently. */
export function OrderTrackingStack({
  orders,
  onDismiss,
}: {
  orders: OrderTrackingItem[];
  onDismiss: (id: string) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();

  if (orders.length === 0) return null;

  return (
    <View style={styles.stack}>
      {orders.map((order) => {
        const current = STEP_INDEX[order.deliveryStatus];
        const { min, max } = etaWindow(order.etaMinutes);
        return (
          <View key={order.id} style={styles.card}>
            <View style={styles.topRow}>
              <Text style={styles.title}>{headline(order.deliveryStatus)}</Text>
              <Pressable onPress={() => onDismiss(order.id)} hitSlop={8}>
                <Ionicons name="close" size={18} color={colors.textLight} />
              </Pressable>
            </View>

            <Text style={styles.orderNo}>
              Order {order.orderNumber}
              {order.deliveryStatus === 'arrived' || order.deliveryStatus === 'delivered'
                ? // An ETA is noise once the driver is standing outside.
                  ' · at your drop-off spot'
                : ` · arriving in about ${min}–${max} min`}
            </Text>

            {/* Progress timeline. */}
            <View style={styles.timeline}>
              {STEPS.map((step, i) => {
                const done = i <= current;
                const active = i === current;
                return (
                  <View key={step.key} style={styles.stepWrap}>
                    <View style={styles.stepRow}>
                      {/* Connector to the previous node. */}
                      {i > 0 ? (
                        <View
                          style={[styles.connector, i <= current && styles.connectorDone]}
                        />
                      ) : (
                        <View style={styles.connectorSpacer} />
                      )}
                      <View
                        style={[
                          styles.node,
                          done && styles.nodeDone,
                          active && styles.nodeActive,
                        ]}
                      >
                        <Ionicons
                          name={step.icon}
                          size={13}
                          color={done ? colors.white : colors.gray400}
                        />
                      </View>
                      {i < STEPS.length - 1 ? (
                        <View
                          style={[styles.connector, i < current && styles.connectorDone]}
                        />
                      ) : (
                        <View style={styles.connectorSpacer} />
                      )}
                    </View>
                    <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>
                      {step.label}
                    </Text>
                  </View>
                );
              })}
            </View>

            <Pressable
              onPress={() => router.push({ pathname: '/chat', params: { orderId: order.id } })}
              style={styles.chatButton}
            >
              <Ionicons name="chatbubble-ellipses" size={15} color={colors.white} />
              <Text style={styles.chatButtonText}>Chat with driver</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    stack: { gap: 12, marginTop: 20, marginHorizontal: 16 },
    card: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 16,
      gap: 12,
      shadowColor: colors.navy,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 16, fontWeight: '800', color: colors.navy, flex: 1 },
    orderNo: { fontSize: 13, color: colors.textLight, marginTop: -4 },
    timeline: { flexDirection: 'row', marginTop: 2 },
    stepWrap: { flex: 1, alignItems: 'center', gap: 6 },
    stepRow: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'center' },
    connector: { flex: 1, height: 3, backgroundColor: colors.gray200, borderRadius: 2 },
    connectorDone: { backgroundColor: colors.orange },
    connectorSpacer: { flex: 1 },
    node: {
      width: 30,
      height: 30,
      borderRadius: 15,
      backgroundColor: colors.gray100,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.gray200,
    },
    nodeDone: { backgroundColor: colors.orange, borderColor: colors.orange },
    nodeActive: {
      shadowColor: colors.orange,
      shadowOpacity: 0.5,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 0 },
      elevation: 4,
    },
    stepLabel: { fontSize: 11, color: colors.gray400, fontWeight: '600' },
    stepLabelDone: { color: colors.navy },
    chatButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.orange,
      borderRadius: radius.md,
      paddingVertical: 12,
    },
    chatButtonText: { fontSize: 14, fontWeight: '700', color: colors.white },
  });
