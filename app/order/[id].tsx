import { useEffect, useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { OrderReceipt } from '../../src/components/OrderReceipt';
import { OrderStatusBadge } from '../../src/components/OrderStatusBadge';
import { useOrdersStore } from '../../src/store/ordersStore';
import { isInFlight, placedAtLabel } from '../../src/lib/orderFormat';
import type { DeliveryStatus, OrderRecord } from '../../src/types';

/** The delivery's milestones, in order — the same four the customer gets a
 *  push for. Shown as a vertical timeline so a glance says where the order is. */
const STEPS: {
  key: DeliveryStatus;
  label: string;
  detail: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  {
    key: 'accepted',
    label: 'Driver assigned',
    detail: 'A driver took your order and is heading to the restaurant.',
    icon: 'person-circle-outline',
  },
  {
    key: 'picked_up',
    label: 'Picked up',
    detail: 'Your order is with the driver and on its way to you.',
    icon: 'bicycle-outline',
  },
  {
    key: 'nearby',
    label: 'Almost there',
    detail: 'Your driver is a few minutes away.',
    icon: 'navigate-outline',
  },
  {
    key: 'arrived',
    label: 'At your door',
    detail: 'Your driver has arrived at your drop-off spot.',
    icon: 'home-outline',
  },
];

const STEP_INDEX: Record<DeliveryStatus, number> = {
  available: -1,
  accepted: 0,
  picked_up: 1,
  nearby: 2,
  arrived: 3,
  // Delivered completes the last step rather than adding a fifth — by then the
  // customer has the food.
  delivered: 3,
};

/**
 * One order in full: where it is, what was in it, and what it cost. Reached
 * from the Orders tab and from tapping any delivery-progress push.
 */
export default function OrderDetailScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();

  // Subscribed to the list rather than looked up once, so the timeline advances
  // live while this screen is open (the realtime tracker writes into the store).
  const orders = useOrdersStore((s) => s.orders);
  const syncDeliveryStatus = useOrdersStore((s) => s.syncDeliveryStatus);
  const order = useMemo(() => orders.find((o) => o.id === id), [orders, id]);

  // A push can open this screen straight from a cold start, before the store
  // has caught up with what the driver did.
  useEffect(() => {
    void syncDeliveryStatus();
  }, [syncDeliveryStatus]);

  if (!order) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => router.back()} title="Order" styles={styles} colors={colors} />
        <View style={styles.missing}>
          <Ionicons name="help-circle-outline" size={44} color={colors.gray400} />
          <Text style={styles.missingText}>
            We couldn't find that order on this device.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header
        onBack={() => router.back()}
        title={order.orderNumber ?? 'Order'}
        styles={styles}
        colors={colors}
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.headline}>
          <OrderStatusBadge order={order} />
          <Text style={styles.placedAt}>Placed {placedAtLabel(order.placedAt)}</Text>
        </View>

        <DeliveryTimeline order={order} styles={styles} colors={colors} />

        {/* The driver's pickup photo — the same shot emailed to the customer. */}
        {order.pickupPhotoURL ? (
          <View style={styles.photoCard}>
            <Text style={styles.photoLabel}>Your order at pickup</Text>
            <Image
              source={{ uri: order.pickupPhotoURL }}
              style={styles.photo}
              resizeMode="cover"
            />
            <Text style={styles.photoHint}>
              Your driver took this when they collected your order. We emailed you a copy.
            </Text>
          </View>
        ) : null}

        <OrderReceipt order={order} />

        {/* Chat only exists once a driver has claimed the order — before that
            there's no one on the other end of the thread. */}
        {order.deliveryStatus && order.deliveryStatus !== 'available' && isInFlight(order) ? (
          <Pressable
            style={styles.chatButton}
            onPress={() => router.push({ pathname: '/chat', params: { orderId: order.id } })}
          >
            <Ionicons name="chatbubble-ellipses" size={16} color={colors.white} />
            <Text style={styles.chatButtonText}>Chat with driver</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function DeliveryTimeline({
  order,
  styles,
  colors,
}: {
  order: OrderRecord;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemePalette;
}) {
  const current = order.deliveryStatus ? STEP_INDEX[order.deliveryStatus] : -1;

  return (
    <View style={styles.timelineCard}>
      <Text style={styles.timelineTitle}>Delivery progress</Text>
      {current < 0 ? (
        <Text style={styles.timelineWaiting}>
          Waiting for a driver to pick up your order. We'll notify you the moment one does.
        </Text>
      ) : null}

      {STEPS.map((step, i) => {
        const done = i <= current;
        const active = i === current;
        return (
          <View key={step.key} style={styles.stepRow}>
            <View style={styles.stepRail}>
              <View style={[styles.stepNode, done && styles.stepNodeDone]}>
                <Ionicons
                  name={step.icon}
                  size={14}
                  color={done ? colors.white : colors.gray400}
                />
              </View>
              {i < STEPS.length - 1 ? (
                <View style={[styles.stepLine, i < current && styles.stepLineDone]} />
              ) : null}
            </View>
            <View style={styles.stepText}>
              <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{step.label}</Text>
              {active || done ? <Text style={styles.stepDetail}>{step.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Header({
  onBack,
  title,
  styles,
  colors,
}: {
  onBack: () => void;
  title: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemePalette;
}) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={26} color={colors.navy} />
      </Pressable>
      <DisplayText size={24} weight="bold" color={colors.navy}>
        {title}
      </DisplayText>
      <View style={styles.backBtn} />
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.offWhite },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    backBtn: { width: 34 },
    scroll: { padding: 16, paddingTop: 4, gap: 14, paddingBottom: 40 },
    headline: { gap: 8 },
    placedAt: { fontSize: 13, color: colors.textLight },
    timelineCard: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 16,
      gap: 4,
    },
    timelineTitle: { fontSize: 15, fontWeight: '800', color: colors.navy, marginBottom: 6 },
    timelineWaiting: { fontSize: 13, color: colors.textLight, marginBottom: 10, lineHeight: 19 },
    stepRow: { flexDirection: 'row', gap: 12 },
    stepRail: { alignItems: 'center', width: 30 },
    stepNode: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.gray100,
      borderWidth: 2,
      borderColor: colors.gray200,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNodeDone: { backgroundColor: colors.orange, borderColor: colors.orange },
    stepLine: { width: 2, flex: 1, minHeight: 18, backgroundColor: colors.gray200 },
    stepLineDone: { backgroundColor: colors.orange },
    stepText: { flex: 1, paddingBottom: 16, gap: 2 },
    stepLabel: { fontSize: 14, fontWeight: '700', color: colors.gray400, marginTop: 4 },
    stepLabelDone: { color: colors.navy },
    stepDetail: { fontSize: 12.5, color: colors.textLight, lineHeight: 18 },
    photoCard: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 16,
      gap: 10,
    },
    photoLabel: { fontSize: 15, fontWeight: '800', color: colors.navy },
    photo: { width: '100%', height: 200, borderRadius: radius.md, backgroundColor: colors.gray100 },
    photoHint: { fontSize: 12.5, color: colors.textLight, lineHeight: 18 },
    chatButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.orange,
      borderRadius: radius.md,
      paddingVertical: 14,
      marginTop: 2,
    },
    chatButtonText: { fontSize: 15, fontWeight: '700', color: colors.white },
    missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
    missingText: { fontSize: 14, color: colors.textLight, textAlign: 'center' },
  });
