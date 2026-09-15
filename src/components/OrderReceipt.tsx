import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius } from '../theme/theme';
import { useTheme, type ThemePalette } from '../theme/ThemeContext';
import { RemoteImage } from './RemoteImage';
import { menuItemById } from '../data/menu';
import { addressLabel, isDemoOrder, money } from '../lib/orderFormat';
import type { OrderRecord } from '../types';

/**
 * The contents of one order: what was bought, what it cost, and where it went.
 * Shared by the post-checkout confirmation and the order-detail screen so the
 * receipt a customer sees the moment they order is the same one they find in
 * their history later.
 */
export function OrderReceipt({ order }: { order: OrderRecord }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const dropoff = addressLabel(order);

  return (
    <View style={{ gap: 14 }}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.restaurant}>{order.restaurantName}</Text>
          <Text style={styles.itemsLabel}>
            {order.items.length} line{order.items.length === 1 ? '' : 's'}
          </Text>
        </View>

        {order.items.map((item) => {
          // The order stores a snapshot of name and price, so a menu edit can't
          // rewrite someone's past receipt. The photo is the one thing looked up
          // live — it's decoration, and a missing item just falls back to text.
          const menuItem = menuItemById(item.menuItemID);
          return (
            <View key={item.id} style={styles.itemRow}>
              {menuItem ? (
                <RemoteImage
                  urlString={menuItem.imageURL}
                  fallbackIcon={menuItem.icon}
                  style={styles.itemImage}
                  iconSize={18}
                  borderRadius={8}
                />
              ) : (
                <View style={[styles.itemImage, styles.itemImageFallback]}>
                  <Ionicons name="fast-food-outline" size={18} color={colors.gray400} />
                </View>
              )}
              <View style={styles.qtyBadge}>
                <Text style={styles.qtyText}>{item.quantity}×</Text>
              </View>
              <Text style={styles.itemName} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.itemPrice}>{money(item.lineTotalCents)}</Text>
            </View>
          );
        })}

        <View style={styles.divider} />

        <TotalRow label="Subtotal" value={money(order.subtotalCents)} styles={styles} />
        <TotalRow label="Delivery fee" value={money(order.deliveryFeeCents)} styles={styles} />
        <TotalRow label="Driver tip" value={money(order.tipCents)} styles={styles} />
        <View style={styles.divider} />
        <View style={styles.totalRow}>
          <Text style={styles.grandLabel}>Total</Text>
          <Text style={styles.grandValue}>{money(order.totalCents)}</Text>
        </View>
        {isDemoOrder(order) ? (
          <Text style={styles.demoNote}>Demo order — no payment was taken.</Text>
        ) : null}
      </View>

      {dropoff ? (
        <View style={styles.card}>
          <View style={styles.addressRow}>
            <Ionicons name="location" size={18} color={colors.orange} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.addressLabel}>Delivering to</Text>
              <Text style={styles.addressValue}>{dropoff}</Text>
              {order.deliveryPreference ? (
                <Text style={styles.addressMeta}>{order.deliveryPreference}</Text>
              ) : null}
              {order.deliveryInstructions ? (
                <Text style={styles.addressMeta}>“{order.deliveryInstructions}”</Text>
              ) : null}
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function TotalRow({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.totalRow}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 16,
      gap: 10,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    restaurant: { fontSize: 16, fontWeight: '800', color: colors.navy, flex: 1 },
    itemsLabel: { fontSize: 12, color: colors.gray400, fontWeight: '600' },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    itemImage: { width: 36, height: 36, borderRadius: 8 },
    itemImageFallback: {
      backgroundColor: colors.gray100,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qtyBadge: {
      minWidth: 26,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      backgroundColor: colors.gray100,
      alignItems: 'center',
    },
    qtyText: { fontSize: 12, fontWeight: '700', color: colors.navy },
    itemName: { flex: 1, fontSize: 14, color: colors.navy },
    itemPrice: { fontSize: 14, fontWeight: '600', color: colors.navy },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.gray200, marginVertical: 2 },
    totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    totalLabel: { fontSize: 14, color: colors.textLight },
    totalValue: { fontSize: 14, color: colors.navy, fontWeight: '600' },
    grandLabel: { fontSize: 16, fontWeight: '800', color: colors.navy },
    grandValue: { fontSize: 18, fontWeight: '800', color: colors.orange },
    demoNote: { fontSize: 12, color: colors.gray400, marginTop: 2 },
    addressRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
    addressLabel: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.gray400,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    addressValue: { fontSize: 14, color: colors.navy, fontWeight: '600' },
    addressMeta: { fontSize: 12.5, color: colors.textLight },
  });
