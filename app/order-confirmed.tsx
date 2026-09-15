import { useEffect, useMemo, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useTheme, type ThemePalette } from '../src/theme/ThemeContext';
import { DisplayText } from '../src/components/DisplayText';
import { GradientButton } from '../src/components/GradientButton';
import { OrderReceipt } from '../src/components/OrderReceipt';
import { useOrdersStore } from '../src/store/ordersStore';
import { itemCountLabel, money } from '../src/lib/orderFormat';

/**
 * Post-checkout confirmation screen: the celebration, and then exactly what
 * was just ordered — items, totals, and where it's going. Reached via
 * router.replace so the hardware back button doesn't return to the paid cart.
 *
 * Takes the order's `id` (the shared dispatch id) and reads the record out of
 * the store rather than receiving it through params, so the screen keeps up
 * with the order number and delivery status as they arrive. Falls back to the
 * newest order, since the one just placed is always at the head of the list.
 */
export default function OrderConfirmedScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const params = useLocalSearchParams<{ id?: string; eta?: string }>();
  const eta = params.eta || '25–35 min';

  const orders = useOrdersStore((s) => s.orders);
  const order = useMemo(
    () => (params.id ? orders.find((o) => o.id === params.id) : orders[0]),
    [orders, params.id],
  );

  // Checkmark badge: pop in with a slight overshoot.
  const badge = useSharedValue(0);
  // Gentle continuous bob for the delivery icon.
  const bob = useSharedValue(0);

  useEffect(() => {
    badge.value = withDelay(
      120,
      withSequence(
        withTiming(1.15, { duration: 340, easing: Easing.out(Easing.back(2)) }),
        withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) }),
      ),
    );
    bob.value = withDelay(
      600,
      withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
  }, [badge, bob]);

  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: badge.value }] }));
  const bobStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -bob.value * 6 }] }));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Animated success badge with expanding pulse rings behind it. */}
        <View style={styles.badgeWrap}>
          <PulseRing delay={0} color={colors.orange} />
          <PulseRing delay={700} color={colors.orangeLight} />
          <PulseRing delay={1400} color={colors.orange} />
          <Animated.View style={[styles.badge, badgeStyle]}>
            <Ionicons name="checkmark-sharp" size={64} color={colors.white} />
          </Animated.View>
        </View>

        <Reveal delay={360}>
          <DisplayText size={40} weight="black" color={colors.navy} style={styles.title}>
            Order Confirmed!
          </DisplayText>
        </Reveal>

        <Reveal delay={500}>
          <View style={styles.riderRow}>
            <Animated.View style={bobStyle}>
              <Ionicons name="bicycle" size={22} color={colors.orange} />
            </Animated.View>
            <Text style={styles.subtitle}>
              {order
                ? `${itemCountLabel(order)} from ${order.restaurantName}`
                : 'Your order is on its way'}
            </Text>
          </View>
        </Reveal>

        {/* ETA + the order's own reference, so the customer can quote it. */}
        <Reveal delay={640} style={styles.etaCard}>
          <Ionicons name="time-outline" size={20} color={colors.orange} />
          <View style={{ flex: 1 }}>
            <Text style={styles.etaLabel}>Estimated arrival</Text>
            <Text style={styles.etaValue}>{eta}</Text>
          </View>
          {order ? (
            <View style={styles.etaRight}>
              <Text style={styles.etaLabel}>{order.orderNumber ? 'Order' : 'Total'}</Text>
              <Text style={styles.etaValue}>
                {order.orderNumber ?? money(order.totalCents)}
              </Text>
            </View>
          ) : null}
        </Reveal>

        {/* Animated "preparing → on the way → delivered" progress dots. */}
        <Reveal delay={820} style={styles.dots}>
          <ProgressDot delay={0} color={colors.orange} />
          <ProgressDot delay={220} color={colors.orange} />
          <ProgressDot delay={440} color={colors.orange} />
        </Reveal>

        {/* What they actually just bought. The whole point of this screen for
            anyone who wants to check the order rather than admire it. */}
        {order ? (
          <Reveal delay={900} style={styles.receipt}>
            <OrderReceipt order={order} />
          </Reveal>
        ) : null}

        <Reveal delay={1000}>
          <Text style={styles.thanks}>Thanks for ordering with LocalGO 🧡</Text>
        </Reveal>
      </ScrollView>

      <Reveal delay={1040} style={styles.footer}>
        <GradientButton title="Back to Home" onPress={() => router.replace('/(tabs)')} />
        <Pressable style={styles.secondary} onPress={() => router.replace('/(tabs)/orders')}>
          <Text style={styles.secondaryText}>View your orders</Text>
        </Pressable>
      </Reveal>
    </SafeAreaView>
  );
}

/** Staggered fade-and-rise reveal. Driven by shared values (not reanimated's
 *  `entering` layout animations, which don't run reliably on web) so it plays
 *  identically on web and native. */
function Reveal({
  delay,
  style,
  children,
}: {
  delay: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(delay, withTiming(1, { duration: 460, easing: Easing.out(Easing.cubic) }));
  }, [p, delay]);
  const animStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * 18 }],
  }));
  return <Animated.View style={[style, animStyle]}>{children}</Animated.View>;
}

/** A ring that repeatedly expands and fades, radiating from the success badge. */
function PulseRing({ delay, color }: { delay: number; color: string }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 2100, easing: Easing.out(Easing.quad) }), -1, false),
    );
  }, [p, delay]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 0.7 + p.value * 1.2 }],
    opacity: 0.5 * (1 - p.value),
  }));
  return <Animated.View pointerEvents="none" style={[ringStyles.ring, { borderColor: color }, style]} />;
}

/** A single bouncing dot in the progress indicator. */
function ProgressDot({ delay, color }: { delay: number; color: string }) {
  const v = useSharedValue(0.4);
  useEffect(() => {
    v.value = withDelay(
      delay,
      withRepeat(withTiming(1, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true),
    );
  }, [v, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.8 + v.value * 0.4 }],
  }));
  return <Animated.View style={[{ backgroundColor: color }, ringStyles.dot, style]} />;
}

const ringStyles = StyleSheet.create({
  ring: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
});

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.offWhite },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 24,
      gap: 16,
    },
    badgeWrap: {
      width: 160,
      height: 160,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 8,
    },
    badge: {
      width: 116,
      height: 116,
      borderRadius: 58,
      backgroundColor: colors.orange,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: colors.orange,
      shadowOpacity: 0.45,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
      elevation: 8,
    },
    title: { textAlign: 'center' },
    riderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    subtitle: { fontSize: 16, color: colors.textLight, fontWeight: '600' },
    etaCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      alignSelf: 'stretch',
      backgroundColor: colors.white,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.gray200,
      paddingVertical: 14,
      paddingHorizontal: 18,
      marginTop: 4,
    },
    etaLabel: { fontSize: 12, color: colors.gray400, fontWeight: '600' },
    etaValue: { fontSize: 17, color: colors.navy, fontWeight: '800' },
    etaRight: { alignItems: 'flex-end' },
    dots: { flexDirection: 'row', gap: 8, marginTop: 6 },
    receipt: { alignSelf: 'stretch', marginTop: 6 },
    thanks: { fontSize: 14, color: colors.textLight, marginTop: 8 },
    footer: { paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
    secondary: { alignItems: 'center', paddingVertical: 12 },
    secondaryText: { fontSize: 15, color: colors.orange, fontWeight: '700' },
  });
