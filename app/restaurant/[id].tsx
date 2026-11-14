import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useCommerceStore } from '../../src/store/commerceStore';
import { getMerchantMenu } from '../../src/lib/consumerApi';
import { Badge } from '../../src/components/ui/Badge';
import { QuantityStepper } from '../../src/components/ui/QuantityStepper';
import { MenuCategoryTabs } from '../../src/components/merchant/MenuCategoryTabs';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { MicroCart } from '../../src/components/cart/MicroCart';
import { radius, fonts } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { RemoteImage } from '../../src/components/RemoteImage';
import { ItemOptionsSheet } from '../../src/components/ItemOptionsSheet';
import { restaurantById } from '../../src/data/restaurants';
import { menuCategoriesForRestaurant, menuItemsForRestaurant } from '../../src/data/menu';
import type { CartLineSelection, MenuItem } from '../../src/types';
import { useCartStore } from '../../src/store/cartStore';

export default function RestaurantMenuScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const catalog = useCommerceStore((s) => s.merchants);
  const mode = useCommerceStore((s) => s.mode);
  const restaurant = catalog.find((m) => m.id === String(id)) ?? restaurantById(String(id));
  const metadata = catalog.find((m) => m.id === String(id));
  const scroller = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const [activeCategory, setActiveCategory] = useState('');
  const [remoteMenu, setRemoteMenu] = useState<MenuItem[] | null>(null);
  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setRemoteMenu(null);
    positions.current = {};
    setActiveCategory('');
    void getMerchantMenu(String(id), controller.signal)
      .then((items) => {
        if (alive) setRemoteMenu(items);
      })
      .catch(() => {});
    return () => {
      alive = false;
      controller.abort();
    };
  }, [id]);

  const lines = useCartStore((s) => s.lines);
  const add = useCartStore((s) => s.add);
  const decrement = useCartStore((s) => s.decrement);
  const quantityFor = useCartStore((s) => s.quantityFor);
  const itemCount = useCartStore((s) => s.itemCount());
  const subtotal = useCartStore((s) => s.subtotal());

  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [replaceItem, setReplaceItem] = useState<MenuItem | null>(null);
  const requestItem = (item: MenuItem) => {
    const cart = useCartStore.getState();
    if (cart.lines.length && cart.restaurantID && cart.restaurantID !== restaurant?.id) {
      setReplaceItem(item);
      return;
    }
    if (item.optionGroups?.length) setSheetItem(item);
    else if (restaurant) add(item, restaurant.id);
  };

  const restaurantMenuItems = useMemo(
    () => remoteMenu ?? (restaurant ? menuItemsForRestaurant(restaurant.id) : []),
    [restaurant, remoteMenu],
  );
  const categories = remoteMenu
    ? [...new Set(remoteMenu.map((item) => item.category))]
    : restaurant?.hasMenu
      ? menuCategoriesForRestaurant(restaurant.id)
      : [];
  const itemsByCategory = useMemo(() => {
    const map: Record<string, MenuItem[]> = {};
    for (const item of restaurantMenuItems) {
      (map[item.category] ??= []).push(item);
    }
    return map;
  }, [restaurantMenuItems]);

  if (!restaurant) {
    return (
      <View style={styles.centered}>
        <Text>Restaurant not found.</Text>
      </View>
    );
  }

  const goToCart = () => {
    router.back();
    router.push('/(tabs)/cart');
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        ref={scroller}
        stickyHeaderIndices={[1]}
        onScroll={(event) => {
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          if (
            categories.length &&
            contentOffset.y + layoutMeasurement.height >= contentSize.height - 2
          ) {
            setActiveCategory(categories[categories.length - 1]);
            return;
          }
          const y = contentOffset.y + 70;
          const current = [...categories]
            .reverse()
            .find(
              (category) =>
                (positions.current.__menu ?? 0) + (positions.current[category] ?? Infinity) <= y,
            );
          if (current) setActiveCategory(current);
        }}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View>
          {/* Hero */}
          <View>
            <RemoteImage
              urlString={restaurant.heroImageURL}
              fallbackIcon={restaurant.heroIcon}
              style={styles.hero}
              iconSize={64}
            />
            <Pressable style={styles.backButton} onPress={() => router.back()} hitSlop={8}>
              <Ionicons name="chevron-back" size={22} color={colors.navy} />
            </Pressable>
          </View>

          {/* Header */}
          <View style={styles.headerBlock}>
            <View style={styles.headerRow}>
              <RemoteImage
                urlString={restaurant.logoURL}
                fallbackIcon={restaurant.heroIcon}
                style={styles.headerLogo}
                iconSize={22}
                borderRadius={26}
              />
              <DisplayText size={36} weight="bold" color={colors.navy} style={{ flex: 1 }}>
                {restaurant.name}
              </DisplayText>
            </View>
            <View style={styles.subMetaRow}>
              <Text style={styles.subMeta}>{restaurant.cuisine}</Text>
              <Text style={styles.dot}>•</Text>
              <Text style={styles.subMeta}>{restaurant.distance}</Text>
            </View>
            <View style={styles.deliveryRow}>
              <View style={styles.deliveryMeta}>
                <Ionicons name="bicycle-outline" size={13} color={colors.textLight} />
                <Text style={styles.subMeta}>
                  {mode === 'pickup' ? 'Pickup · no delivery fee' : restaurant.deliveryFee}
                </Text>
              </View>
              <View style={styles.deliveryMeta}>
                <Ionicons name="time-outline" size={13} color={colors.textLight} />
                <Text style={styles.subMeta}>{restaurant.deliveryTime}</Text>
              </View>
            </View>
          </View>

          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: 8,
              paddingHorizontal: 20,
              paddingBottom: 20,
            }}
          >
            {metadata?.verified ? (
              <Badge label="LocalGO verified" icon="checkmark-circle" tone="accent" />
            ) : null}
            {metadata?.topLocal ? <Badge label="Top local merchant" tone="dark" /> : null}
            {metadata?.rating != null ? (
              <Badge
                label={`${metadata.rating.toFixed(1)} (${metadata.reviewCount})`}
                icon="star"
              />
            ) : null}
          </View>
        </View>
        <MenuCategoryTabs
          categories={categories}
          active={activeCategory || categories[0]}
          onSelect={(category) => {
            setActiveCategory(category);
            scroller.current?.scrollTo({
              y: Math.max(
                0,
                (positions.current.__menu ?? 0) + (positions.current[category] ?? 0) - 66,
              ),
              animated: true,
            });
          }}
        />
        {/* Menu */}
        {restaurant.hasMenu ? (
          <View
            style={{ gap: 24 }}
            onLayout={(event) => {
              positions.current.__menu = event.nativeEvent.layout.y;
            }}
          >
            {categories.map((category) => (
              <View
                key={category}
                style={{ gap: 10 }}
                onLayout={(event) => {
                  positions.current[category] = event.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.categoryTitle}>{category}</Text>
                <View style={{ gap: 10, paddingHorizontal: 20 }}>
                  {itemsByCategory[category]?.map((item) => {
                    const hasOptions = (item.optionGroups?.length ?? 0) > 0;
                    const quantity =
                      useCartStore.getState().restaurantID !== restaurant.id
                        ? 0
                        : hasOptions
                          ? quantityFor(item.id)
                          : (lines.find((l) => l.item.id === item.id)?.quantity ?? 0);
                    const Row = (
                      <View style={styles.menuRow}>
                        <View style={{ flex: 1, gap: 4, paddingVertical: 6 }}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          {item.itemDescription ? (
                            <Text style={styles.itemDesc} numberOfLines={3}>
                              {item.itemDescription}
                            </Text>
                          ) : null}
                          <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
                        </View>
                        <View style={{ gap: 10, alignItems: 'flex-end' }}>
                          <RemoteImage
                            urlString={item.imageURL}
                            fallbackIcon={item.icon}
                            style={styles.menuImage}
                            iconSize={24}
                            borderRadius={16}
                          />
                          <QuantityStepper
                            quantity={quantity}
                            label={item.name}
                            min={hasOptions ? quantity : 0}
                            onAdd={() => requestItem(item)}
                            onRemove={() => {
                              if (!hasOptions) decrement(item);
                            }}
                          />
                        </View>
                      </View>
                    );
                    return hasOptions ? (
                      <Pressable key={item.id} onPress={() => requestItem(item)}>
                        {Row}
                      </Pressable>
                    ) : (
                      <View key={item.id}>{Row}</View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.comingSoon}>
            <Ionicons name="restaurant-outline" size={52} color={colors.orangeLight} />
            <Text style={styles.comingSoonTitle}>Menu coming soon</Text>
            <Text style={styles.comingSoonBody}>
              {restaurant.name} isn't taking orders on LocalGO just yet. Check back soon!
            </Text>
          </View>
        )}
      </ScrollView>

      <MicroCart onPress={goToCart} />

      <ConfirmModal
        visible={replaceItem !== null}
        onCancel={() => setReplaceItem(null)}
        title="Start a new bag?"
        message={`Your current bag is from another store. Replace it with an order from ${restaurant.name}?`}
        confirmLabel="Start new bag"
        onConfirm={() => {
          const item = replaceItem;
          setReplaceItem(null);
          useCartStore.getState().clear();
          if (item) requestItem(item);
        }}
      />
      <ItemOptionsSheet
        visible={sheetItem !== null}
        item={sheetItem}
        onClose={() => setSheetItem(null)}
        onAddToCart={(selections: CartLineSelection[], notes: string, quantity: number) => {
          if (!sheetItem) return;
          for (let i = 0; i < quantity; i++) {
            add(sheetItem, restaurant.id, selections, notes || undefined);
          }
          setSheetItem(null);
        }}
      />
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      backgroundColor: colors.offWhite,
    },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    hero: { height: 210, width: '100%' },
    backButton: {
      position: 'absolute',
      top: 16,
      left: 20,
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.white,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerBlock: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18, gap: 12 },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    headerLogo: { width: 50, height: 50, borderWidth: 1, borderColor: colors.gray200 },
    subMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
    subMeta: { fontSize: 13, color: colors.textLight },
    dot: { fontSize: 12, color: colors.textLight },
    deliveryRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 18,
      paddingVertical: 14,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderTopColor: colors.gray200,
      borderBottomColor: colors.gray200,
    },
    deliveryMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    categoryTitle: {
      fontFamily: fonts.displayBold,
      fontSize: 29,
      color: colors.navy,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    menuRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 20,
      paddingVertical: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.gray200,
    },
    menuImage: { width: 104, height: 104 },
    itemName: { fontSize: 16, fontWeight: '700', lineHeight: 22, color: colors.navy },
    itemDesc: { fontSize: 13, lineHeight: 19, color: colors.textLight },
    itemPrice: { fontSize: 15, fontWeight: '700', color: colors.navy, marginTop: 7 },
    qtyControl: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'flex-end',
      alignItems: 'center',
      gap: 8,
      maxWidth: 90,
    },
    qtyText: {
      fontSize: 14,
      fontWeight: '700',
      minWidth: 16,
      textAlign: 'center',
      color: colors.navy,
    },
    comingSoon: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 60, gap: 12 },
    comingSoonTitle: { fontSize: 17, fontWeight: '700', color: colors.navy },
    comingSoonBody: { fontSize: 14, color: colors.textLight, textAlign: 'center' },
    cartBarWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    cartBar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: radius.md,
      paddingVertical: 20,
      paddingHorizontal: 20,
    },
    cartBarText: { color: colors.onBrand, fontSize: 15, fontWeight: '600' },
  });
