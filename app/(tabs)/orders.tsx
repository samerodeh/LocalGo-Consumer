import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { OrderStatusBadge } from '../../src/components/OrderStatusBadge';
import { useOrdersStore } from '../../src/store/ordersStore';
import {
  isInFlight,
  itemCountLabel,
  money,
  placedAtLabel,
} from '../../src/lib/orderFormat';
import type { OrderRecord } from '../../src/types';

/**
 * The customer's order history. In-flight orders sit at the top under "Active"
 * so the thing they're waiting on is the first thing they see; everything else
 * is a scrollable record of past orders. Tapping any of them opens the full
 * receipt.
 *
 * Reads entirely from local storage — orders are persisted per account — and
 * pulls live delivery progress in on top when a backend is configured, so the
 * screen is fully functional offline and in demo mode.
 */
export default function OrdersScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const orders = useOrdersStore((s) => s.orders);
  const syncDeliveryStatus = useOrdersStore((s) => s.syncDeliveryStatus);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await syncDeliveryStatus();
    setRefreshing(false);
  }, [syncDeliveryStatus]);

  const { active, past } = useMemo(() => {
    const active: OrderRecord[] = [];
    const past: OrderRecord[] = [];
    for (const order of orders) (isInFlight(order) ? active : past).push(order);
    return { active, past };
  }, [orders]);

  const open = (order: OrderRecord) =>
    router.push({ pathname: '/order/[id]', params: { id: order.id } });

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.titleBar}>
        <DisplayText size={26} weight="bold" color={colors.navy}>
          Orders
        </DisplayText>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.orange} />
        }
      >
        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color={colors.gray400} />
            <Text style={styles.emptyTitle}>No orders yet</Text>
            <Text style={styles.emptyBody}>
              Once you place an order it'll show up here, with everything you ordered and
              where it got to.
            </Text>
            <Pressable style={styles.browseBtn} onPress={() => router.push('/(tabs)')}>
              <Text style={styles.browseBtnText}>Browse restaurants</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {active.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Active</Text>
                {active.map((order) => (
                  <OrderRow key={order.id} order={order} onPress={open} styles={styles} colors={colors} />
                ))}
              </View>
            ) : null}

            {past.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {active.length > 0 ? 'Past orders' : 'Your orders'}
                </Text>
                {past.map((order) => (
                  <OrderRow key={order.id} order={order} onPress={open} styles={styles} colors={colors} />
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** One order in the list: who it was from, when, what it cost, and where it
 *  got to. Enough to recognise an order without opening it. */
function OrderRow({
  order,
  onPress,
  styles,
  colors,
}: {
  order: OrderRecord;
  onPress: (order: OrderRecord) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemePalette;
}) {
  return (
    <Pressable style={styles.card} onPress={() => onPress(order)}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.restaurant} numberOfLines={1}>
            {order.restaurantName}
          </Text>
          <Text style={styles.meta}>
            {placedAtLabel(order.placedAt)} · {itemCountLabel(order)}
          </Text>
        </View>
        <Text style={styles.total}>{money(order.totalCents)}</Text>
      </View>

      {/* The first couple of items, so the row is recognisable at a glance. */}
      <Text style={styles.items} numberOfLines={1}>
        {order.items.map((item) => `${item.quantity}× ${item.name}`).join(', ')}
      </Text>

      <View style={styles.cardBottom}>
        <OrderStatusBadge order={order} />
        <View style={styles.cardBottomRight}>
          {order.orderNumber ? (
            <Text style={styles.orderNumber}>{order.orderNumber}</Text>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={colors.gray300} />
        </View>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.offWhite },
    titleBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    scroll: { padding: 16, paddingTop: 4, gap: 24, paddingBottom: 32 },
    section: { gap: 12 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 4,
    },
    card: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 16,
      gap: 10,
      shadowColor: colors.navy,
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    restaurant: { fontSize: 16, fontWeight: '800', color: colors.navy },
    meta: { fontSize: 12.5, color: colors.textLight },
    total: { fontSize: 16, fontWeight: '800', color: colors.navy },
    items: { fontSize: 13, color: colors.textLight },
    cardBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.gray200,
      paddingTop: 10,
    },
    cardBottomRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    orderNumber: { fontSize: 12.5, color: colors.gray400, fontWeight: '600' },
    empty: { alignItems: 'center', paddingTop: 72, paddingHorizontal: 24, gap: 10 },
    emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.navy, marginTop: 6 },
    emptyBody: { fontSize: 14, color: colors.textLight, textAlign: 'center', lineHeight: 20 },
    browseBtn: {
      marginTop: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.orange,
    },
    browseBtnText: { fontSize: 14, fontWeight: '700', color: colors.orange },
  });
