import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { GradientButton } from '../../src/components/GradientButton';
import { RemoteImage } from '../../src/components/RemoteImage';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { useCartStore } from '../../src/store/cartStore';
import { useAddressStore } from '../../src/store/addressStore';
import { useAuthStore } from '../../src/store/authStore';
import { placeOrder } from '../../src/lib/placeOrder';
import { deliveryLocationProblem, isValidDeliveryLocation } from '../../src/lib/deliveryLocation';
// Goer chatbot disabled for now.
// import { GoerFab } from '../../src/components/goer/GoerFab';

/** DoorDash-style tip presets, as a percentage of the food subtotal. */
const TIP_PRESETS = [0, 15, 18, 20, 25] as const;
const DEFAULT_TIP_PERCENT = 18;
const round2 = (n: number) => Math.round(n * 100) / 100;

export default function CartScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const lines = useCartStore((s) => s.lines);
  const add = useCartStore((s) => s.add);
  const decrement = useCartStore((s) => s.decrement);
  const subtotal = useCartStore((s) => s.subtotal());
  const deliveryFee = useCartStore((s) => s.deliveryFee());
  const cartRestaurantID = useCartStore((s) => s.restaurantID);

  const defaultAddress = useAddressStore((s) => s.defaultAddress);
  const currentUser = useAuthStore((s) => s.currentUser);

  const [processing, setProcessing] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  // Tip is either one of the % presets or a custom dollar amount.
  const [tipPercent, setTipPercent] = useState<number | null>(DEFAULT_TIP_PERCENT);
  const [customTip, setCustomTip] = useState('');

  const tip = useMemo(() => {
    if (tipPercent === null) {
      const parsed = parseFloat(customTip);
      return Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : 0;
    }
    return round2((subtotal * tipPercent) / 100);
  }, [tipPercent, customTip, subtotal]);

  const total = round2(subtotal + deliveryFee + tip);
  const hasValidLocation = isValidDeliveryLocation(defaultAddress);

  // Checkout is gated on a verified delivery location: no valid address, no
  // confirm dialog — the user is routed to the Address screen instead.
  const startCheckout = () => {
    if (!hasValidLocation) {
      Alert.alert(
        'Delivery address needed',
        deliveryLocationProblem(defaultAddress) ?? 'Please add a delivery address.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add address', onPress: () => router.push('/address') },
        ],
      );
      return;
    }
    setConfirmVisible(true);
  };

  const submitOrder = async () => {
    if (lines.length === 0 || processing) return;
    setProcessing(true);

    const result = await placeOrder({
      lines,
      subtotal,
      deliveryFee,
      tip,
      total,
      restaurantID: cartRestaurantID,
      deliveryAddress: defaultAddress,
      customer: currentUser,
    });

    setProcessing(false);
    if (result.ok) {
      // Paid but undispatched: the money is gone, so this must never look like
      // a failure the user should retry.
      if (result.warning) {
        Alert.alert('Order placed', result.warning);
      }
      // Replace (not push) so the hardware back button can't return to the
      // now-paid, cleared cart. The id lets the confirmation screen show this
      // exact order rather than guessing at the newest one.
      router.replace({ pathname: '/order-confirmed', params: { id: result.orderId } });
    } else if (result.canceled) {
      // User dismissed the payment sheet. Nothing was charged and the cart is
      // untouched — say nothing and leave them on it.
    } else {
      Alert.alert('Order Failed', result.error);
    }
  };

  if (lines.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.titleBar}>
          <DisplayText size={26} weight="bold">
            Cart
          </DisplayText>
        </View>
        <View style={styles.empty}>
          <Ionicons name="cart-outline" size={48} color={colors.gray400} />
          <Text style={styles.emptyTitle}>Your cart is empty</Text>
          <Text style={styles.emptyBody}>Add items from a restaurant to get started.</Text>
        </View>
        {/* <GoerFab /> */}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.titleBar}>
        <DisplayText size={26} weight="bold" color={colors.navy}>
          Cart
        </DisplayText>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {lines.map((line) => (
          <View key={line.item.id} style={styles.row}>
            <RemoteImage
              urlString={line.item.imageURL}
              fallbackIcon={line.item.icon}
              style={styles.rowImage}
              iconSize={20}
              borderRadius={10}
            />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rowName}>{line.item.name}</Text>
              <Text style={styles.rowPrice}>${line.item.price.toFixed(2)}</Text>
            </View>
            <View style={styles.qtyControl}>
              <Pressable onPress={() => decrement(line.item)} hitSlop={6}>
                <Ionicons name="remove-circle" size={24} color={colors.orange} />
              </Pressable>
              <Text style={styles.qtyText}>{line.quantity}</Text>
              <Pressable onPress={() => add(line.item)} hitSlop={6}>
                <Ionicons name="add-circle" size={24} color={colors.orange} />
              </Pressable>
            </View>
          </View>
        ))}

        {/* Tip your driver (DoorDash-style) */}
        <View style={styles.tipCard}>
          <View style={styles.tipHeader}>
            <Ionicons name="heart" size={16} color={colors.orange} />
            <Text style={styles.tipTitle}>Add a tip for your driver</Text>
          </View>
          <Text style={styles.tipSub}>100% of your tip goes to the driver.</Text>
          <View style={styles.tipRow}>
            {TIP_PRESETS.map((pct) => {
              const active = tipPercent === pct;
              return (
                <Pressable
                  key={pct}
                  style={[styles.tipChip, active && styles.tipChipActive]}
                  onPress={() => {
                    setTipPercent(pct);
                    setCustomTip('');
                  }}
                >
                  <Text style={[styles.tipChipText, active && styles.tipChipTextActive]}>
                    {pct === 0 ? 'None' : `${pct}%`}
                  </Text>
                  {pct !== 0 ? (
                    <Text style={[styles.tipChipAmt, active && styles.tipChipTextActive]}>
                      ${round2((subtotal * pct) / 100).toFixed(2)}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            <Pressable
              style={[styles.tipChip, tipPercent === null && styles.tipChipActive]}
              onPress={() => setTipPercent(null)}
            >
              <Text style={[styles.tipChipText, tipPercent === null && styles.tipChipTextActive]}>
                Custom
              </Text>
            </Pressable>
          </View>
          {tipPercent === null ? (
            <View style={styles.customTipRow}>
              <Text style={styles.customTipDollar}>$</Text>
              <TextInput
                placeholder="0.00"
                placeholderTextColor={colors.gray400}
                value={customTip}
                onChangeText={setCustomTip}
                keyboardType="decimal-pad"
                style={styles.customTipInput}
                autoFocus
              />
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={styles.summary}>
        <Pressable style={styles.addressRow} onPress={() => router.push('/address')}>
          <Ionicons
            name={hasValidLocation ? 'location' : 'alert-circle'}
            size={18}
            color={hasValidLocation ? colors.orange : '#D9534F'}
          />
          <Text
            style={[styles.addressRowText, !hasValidLocation && styles.addressRowWarn]}
            numberOfLines={1}
          >
            {hasValidLocation && defaultAddress
              ? `Deliver to ${defaultAddress.addressLine}`
              : 'Add a delivery address to place your order'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.gray400} />
        </Pressable>
        <SummaryRow label="Subtotal" value={subtotal} styles={styles} />
        <SummaryRow label="Delivery Fee" value={deliveryFee} styles={styles} />
        <SummaryRow label="Driver Tip" value={tip} styles={styles} />
        <View style={styles.divider} />
        <SummaryRow label="Total" value={total} emphasized styles={styles} />
        <GradientButton
          title={`Place Order • $${total.toFixed(2)}`}
          loading={processing}
          onPress={startCheckout}
          style={{ marginTop: 8 }}
        />
      </View>

      {/* Lifted clear of the summary/checkout bar below. */}
      {/* <GoerFab bottomOffset={210} /> */}

      <ConfirmModal
        visible={confirmVisible}
        title="Place your order?"
        message={`You're about to order ${lines.reduce((n, l) => n + l.quantity, 0)} item${
          lines.reduce((n, l) => n + l.quantity, 0) === 1 ? '' : 's'
        } for $${total.toFixed(2)} (incl. $${tip.toFixed(2)} tip). Continue?`}
        confirmLabel="Yes, Order"
        cancelLabel="Not yet"
        onCancel={() => setConfirmVisible(false)}
        onConfirm={() => {
          setConfirmVisible(false);
          void submitOrder();
        }}
      />
    </SafeAreaView>
  );
}

function SummaryRow({
  label,
  value,
  emphasized,
  styles,
}: {
  label: string;
  value: number;
  emphasized?: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, emphasized && styles.summaryStrong]}>{label}</Text>
      <Text style={[styles.summaryValue, emphasized && styles.summaryStrong]}>
        ${value.toFixed(2)}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.offWhite },
  titleBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingBottom: 60 },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.navy },
  emptyBody: { fontSize: 14, color: colors.textLight },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 10,
    marginBottom: 10,
  },
  rowImage: { width: 48, height: 48 },
  rowName: { fontSize: 14, fontWeight: '700', color: colors.navy },
  rowPrice: { fontSize: 12, color: colors.textLight },
  qtyControl: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyText: { fontSize: 14, fontWeight: '700', minWidth: 16, textAlign: 'center', color: colors.navy },
  tipCard: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 14,
    marginTop: 6,
    gap: 8,
  },
  tipHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tipTitle: { fontSize: 15, fontWeight: '700', color: colors.navy },
  tipSub: { fontSize: 12, color: colors.textLight },
  tipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  tipChip: {
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray200,
    backgroundColor: colors.white,
    alignItems: 'center',
  },
  tipChipActive: { backgroundColor: colors.orange, borderColor: colors.orange },
  tipChipText: { fontSize: 14, fontWeight: '700', color: colors.navy },
  tipChipAmt: { fontSize: 11, color: colors.textLight, marginTop: 1 },
  tipChipTextActive: { color: colors.white },
  customTipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    marginTop: 4,
  },
  customTipDollar: { fontSize: 16, fontWeight: '700', color: colors.navy },
  customTipInput: { flex: 1, paddingVertical: 12, paddingHorizontal: 6, fontSize: 16, color: colors.navy },
  summary: {
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  addressRowText: { flex: 1, fontSize: 13.5, color: colors.navy, fontWeight: '600' },
  addressRowWarn: { color: '#D9534F' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryLabel: { fontSize: 14, color: colors.textLight },
  summaryValue: { fontSize: 14, color: colors.navy },
  summaryStrong: { fontWeight: '700', color: colors.navy },
  divider: { height: 1, backgroundColor: colors.gray200 },
});
