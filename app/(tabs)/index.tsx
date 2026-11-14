import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../../src/theme/theme';
import { useTheme } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { RemoteImage } from '../../src/components/RemoteImage';
import { restaurants } from '../../src/data/restaurants';
import { menuItems } from '../../src/data/menu';
import { useAuthStore } from '../../src/store/authStore';
import { useAddressStore } from '../../src/store/addressStore';
import { useOrderTracking } from '../../src/store/useOrderTracking';
import { usePendingOrders } from '../../src/store/usePendingOrders';
import { OrderTrackingStack } from '../../src/components/OrderTrackingStack';
import { PendingOrderStack } from '../../src/components/PendingOrderStack';
import { CategoryStories } from '../../src/components/discovery/CategoryStories';
import { MerchantCard } from '../../src/components/discovery/MerchantCard';
import { MerchantRail } from '../../src/components/discovery/MerchantRail';
import { AddressPickerSheet } from '../../src/components/address/AddressPickerSheet';
import { MicroCart } from '../../src/components/cart/MicroCart';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { useCommerceStore } from '../../src/store/commerceStore';
import { distanceKm } from '../../src/lib/deliveryZone';
import type { MerchantCategory } from '../../src/types/commerce';
import { useConsumerOrders } from '../../src/store/useConsumerOrders';
import { ConsumerOrderStack } from '../../src/components/tracking/ConsumerOrderStack';

export default function HomeScreen() {
  const router = useRouter();
  const { trackOrderId } = useLocalSearchParams<{ trackOrderId?: string }>();
  const { colors: c } = useTheme();
  const [search, setSearch] = useState('');
  const [addressOpen, setAddressOpen] = useState(false);
  const firstName = useAuthStore((s) => s.currentUser?.firstName ?? '');
  const address = useAddressStore((s) => s.defaultAddress);
  const live = useConsumerOrders();
  useEffect(() => {
    if (trackOrderId) live.refresh();
  }, [trackOrderId, live.refresh]);
  const { orders: activeOrders, dismiss } = useOrderTracking();
  const { pending } = usePendingOrders();
  const { mode, category, merchants, ready, loading, refresh, setMode, setCategory } =
    useCommerceStore();
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const available = useMemo(
    () => new Set<MerchantCategory>(ready ? merchants.map((m) => m.category) : ['restaurants']),
    [ready, merchants],
  );
  const catalog = useMemo(() => {
    const source = ready ? merchants : restaurants;
    return source
      .filter(
        (m) =>
          (!ready || merchants.find((x) => x.id === m.id)?.category === category) &&
          (mode !== 'pickup' || merchants.find((x) => x.id === m.id)?.pickupEnabled),
      )
      .map((m) => {
        const meta = merchants.find((x) => x.id === m.id);
        const km =
          address && meta?.latitude != null && meta.longitude != null
            ? distanceKm(address.latitude, address.longitude, meta.latitude, meta.longitude)
            : null;
        return {
          ...m,
          distance: km == null ? '' : km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`,
          deliveryFee: mode === 'pickup' ? 'Pickup · no delivery fee' : m.deliveryFee,
        };
      });
  }, [ready, merchants, category, mode, address]);
  const results = catalog.filter((m) =>
    `${m.name} ${m.cuisine}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const fastest = [...catalog].sort(
    (a, b) =>
      (merchants.find((m) => m.id === a.id)?.etaMin ?? parseInt(a.deliveryTime)) -
      (merchants.find((m) => m.id === b.id)?.etaMin ?? parseInt(b.deliveryTime)),
  );
  const favorites = [...catalog].sort(
    (a, b) =>
      (merchants.find((m) => m.id === b.id)?.rating ?? 0) -
      (merchants.find((m) => m.id === a.id)?.rating ?? 0),
  );
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.offWhite }]} edges={['top']}>
      <View style={styles.topbar}>
        <View style={{ flex: 1, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <DisplayText size={26} weight="heavy">
              Local<Text style={{ color: c.orange }}>GO</Text>
            </DisplayText>
            <Text
              style={{ color: c.textLight, fontSize: 10, fontWeight: '600', letterSpacing: 0.7 }}
            >
              YOUR NEIGHBOURHOOD
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change delivery address or pickup mode"
            onPress={() => setAddressOpen(true)}
            style={styles.address}
          >
            <Ionicons
              name={mode === 'delivery' ? 'location' : 'bag-handle'}
              color={c.accentInk}
              size={16}
            />
            <View style={{ flexShrink: 1 }}>
              <Text style={{ fontSize: 10, color: c.textLight, fontWeight: '600' }}>
                {mode === 'delivery' ? 'Deliver now to' : 'Picking up from'}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontSize: 14, fontWeight: '700', color: c.navy, maxWidth: 260 }}
              >
                {mode === 'delivery'
                  ? (address?.addressLine ?? 'Choose your address')
                  : 'Local stores'}
              </Text>
            </View>
            <Ionicons name="chevron-down" size={15} color={c.navy} />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          onPress={() => router.push('/(tabs)/settings')}
          style={[styles.profile, { backgroundColor: c.white, borderColor: c.gray200 }]}
        >
          <Ionicons name="person-outline" size={21} color={c.navy} />
        </Pressable>
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View style={[styles.search, { backgroundColor: c.white, borderColor: c.gray200 }]}>
          <Ionicons name="search" size={21} color={c.navy} />
          <TextInput
            accessibilityLabel="Search restaurants or cuisines"
            placeholder="What are you craving?"
            placeholderTextColor={c.textLight}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            returnKeyType="search"
            style={[styles.searchInput, { color: c.navy }]}
          />
          {search ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setSearch('')}
              style={styles.clear}
            >
              <Ionicons name="close-circle" size={20} color={c.textLight} />
            </Pressable>
          ) : null}
        </View>
        <CategoryStories selected={category} available={available} onSelect={setCategory} />
        <PendingOrderStack
          orders={pending.filter((o) => !live.orders.some((n) => n.id === o.id))}
        />
        <OrderTrackingStack
          orders={activeOrders.filter((o) => !live.orders.some((n) => n.id === o.id))}
          onDismiss={dismiss}
        />
        {live.error && (live.orders.length || trackOrderId) ? (
          <View
            style={{
              marginHorizontal: 20,
              padding: 12,
              backgroundColor: c.accentSoft,
              borderRadius: 14,
            }}
          >
            <Text
              accessibilityRole="alert"
              style={{ color: c.accentInk, fontSize: 12, lineHeight: 19 }}
            >
              {live.orders.length
                ? 'Live updates are paused. Showing your last known order status.'
                : 'Could not load order updates. Please try again.'}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={live.refresh}
              style={{ minHeight: 44, justifyContent: 'center' }}
            >
              <Text style={{ color: c.accentInk, fontWeight: '700' }}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
        <ConsumerOrderStack
          orders={live.orders}
          refresh={live.refresh}
          initialOrderId={trackOrderId}
        />
        {!search.trim() ? (
          <>
            <View style={styles.greeting}>
              <Text
                style={{ color: c.accentInk, fontWeight: '800', fontSize: 10, letterSpacing: 1.8 }}
              >
                {firstName ? `HEY, ${firstName.toUpperCase()}` : 'YOUR DAILY DOSE OF LOCAL'}
              </Text>
              <DisplayText size={32} weight="heavy">
                Find your local favourite.
              </DisplayText>
            </View>
            <View style={[styles.editorial, { backgroundColor: c.butter }]}>
              <View style={{ flex: 1, gap: 9, paddingVertical: 6 }}>
                <Text
                  style={{
                    color: c.butterMuted,
                    fontSize: 9,
                    letterSpacing: 1.2,
                    fontWeight: '800',
                  }}
                >
                  A LITTLE CLOSER. A LOT TASTIER.
                </Text>
                <DisplayText size={29} weight="heavy" color={c.onButter}>
                  Big cravings.{'\n'}Local love.
                </DisplayText>
                <Text style={{ color: c.butterMuted, fontSize: 12, lineHeight: 18, maxWidth: 180 }}>
                  Made around the corner. Enjoyed wherever you are.
                </Text>
              </View>
              <View style={styles.plate}>
                <RemoteImage
                  urlString={menuItems[0]?.imageURL ?? null}
                  fallbackIcon="restaurant-outline"
                  style={{ width: 128, height: 128 }}
                  borderRadius={64}
                />
              </View>
            </View>
            {loading && !ready ? (
              <View style={{ padding: 20, gap: 12 }} accessibilityLabel="Loading local stores">
                <Skeleton style={{ height: 150 }} />
                <Skeleton style={{ height: 20, width: '65%' }} />
              </View>
            ) : null}
            <MerchantRail
              title="Local favourites"
              subtitle="A little neighbourhood love in every order."
              merchants={favorites}
              metadata={merchants}
            />
            <MerchantRail
              title="Fastest near you"
              subtitle="Less waiting. More enjoying."
              merchants={fastest}
              metadata={merchants}
            />
          </>
        ) : null}
        <View style={styles.section}>
          <View style={{ gap: 4 }}>
            <DisplayText size={29}>
              {search.trim() ? 'Search results' : 'Explore your neighbourhood'}
            </DisplayText>
            <Text style={{ color: c.textLight, fontSize: 13 }}>
              {results.length} {results.length === 1 ? 'store' : 'stores'}{' '}
              {mode === 'pickup' ? 'available for pickup' : 'to discover'}
            </Text>
          </View>
          <View style={[styles.count, { backgroundColor: c.accentSoft }]}>
            <Text style={{ color: c.accentInk, fontWeight: '800' }}>{results.length}</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: 20, gap: 26 }}>
          {results.map((m) => (
            <MerchantCard
              key={m.id}
              merchant={m}
              metadata={merchants.find((x) => x.id === m.id)}
              onPress={() => router.push(`/restaurant/${m.id}`)}
            />
          ))}
          {!results.length ? (
            <View style={{ alignItems: 'center', padding: 32, gap: 12 }}>
              <Ionicons name="search-outline" size={36} color={c.textLight} />
              <Text style={{ color: c.navy, fontSize: 16, fontWeight: '700' }}>
                No stores found
              </Text>
              <Text style={{ color: c.textLight, lineHeight: 21, textAlign: 'center' }}>
                Try another search or switch your category or order type.
              </Text>
            </View>
          ) : null}
        </View>
        <View style={{ alignItems: 'center', paddingTop: 36, gap: 6 }}>
          <Ionicons name="heart-outline" color={c.accentInk} size={20} />
          <Text style={{ fontSize: 12, color: c.textLight }}>
            Small businesses. Big part of your day.
          </Text>
        </View>
      </ScrollView>
      <MicroCart />
      <AddressPickerSheet
        visible={addressOpen}
        onClose={() => setAddressOpen(false)}
        mode={mode}
        onModeChange={setMode}
        pickupAvailable={merchants.some((m) => m.pickupEnabled)}
      />
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 720, alignSelf: 'center' },
  topbar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  address: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44 },
  profile: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    marginHorizontal: 20,
    minHeight: 54,
    paddingLeft: 16,
    paddingRight: 8,
    borderWidth: 1,
    borderRadius: radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  searchInput: { flex: 1, minWidth: 0, fontSize: 15, paddingVertical: 16 },
  clear: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  greeting: { paddingHorizontal: 20, gap: 8, marginTop: 6, marginBottom: 18 },
  editorial: {
    marginHorizontal: 20,
    padding: 20,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    gap: 8,
  },
  plate: {
    width: 124,
    height: 132,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-12deg' }],
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 32,
    marginBottom: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  count: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
