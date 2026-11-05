import { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { accentGradient } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { CartNotice } from '../../src/components/CartNotice';
import { DisplayText } from '../../src/components/DisplayText';
import { RemoteImage } from '../../src/components/RemoteImage';
import { restaurantById } from '../../src/data/restaurants';
import { menuCategoriesForRestaurant, menuItemsForRestaurant } from '../../src/data/menu';
import type { MenuItem } from '../../src/types';
import { useCartStore } from '../../src/store/cartStore';

export default function RestaurantMenuScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const restaurant = restaurantById(String(id));

  const lines = useCartStore((s) => s.lines);
  const add = useCartStore((s) => s.add);
  const decrement = useCartStore((s) => s.decrement);
  const itemCount = useCartStore((s) => s.itemCount());
  const subtotal = useCartStore((s) => s.subtotal());

  const restaurantMenuItems = useMemo(
    () => (restaurant ? menuItemsForRestaurant(restaurant.id) : []),
    [restaurant],
  );
  const categories = restaurant?.hasMenu ? menuCategoriesForRestaurant(restaurant.id) : [];
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
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: itemCount > 0 ? 100 : 24 }}>
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

        <CartNotice />
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
            <DisplayText size={28} weight="bold" color={colors.navy}>
              {restaurant.name}
            </DisplayText>
          </View>
          <View style={styles.subMetaRow}>
            <Ionicons name="star" size={12} color={colors.star} />
            <Text style={styles.subMetaStrong}>{restaurant.rating}</Text>
            <Text style={styles.subMeta}>({restaurant.reviewCount} reviews)</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.subMeta}>{restaurant.cuisine}</Text>
            <Text style={styles.dot}>•</Text>
            <Text style={styles.subMeta}>{restaurant.distance}</Text>
          </View>
          <View style={styles.deliveryRow}>
            <View style={styles.deliveryMeta}>
              <Ionicons name="bicycle-outline" size={13} color={colors.textLight} />
              <Text style={styles.subMeta}>{restaurant.deliveryFee}</Text>
            </View>
            <View style={styles.deliveryMeta}>
              <Ionicons name="time-outline" size={13} color={colors.textLight} />
              <Text style={styles.subMeta}>{restaurant.deliveryTime}</Text>
            </View>
          </View>
        </View>

        {/* Menu */}
        {restaurant.hasMenu ? (
          <View style={{ marginTop: 20, gap: 24 }}>
            {categories.map((category) => (
              <View key={category} style={{ gap: 10 }}>
                <Text style={styles.categoryTitle}>{category}</Text>
                <View style={{ gap: 10, paddingHorizontal: 16 }}>
                  {itemsByCategory[category]?.map((item) => {
                    const quantity = lines.find((l) => l.item.id === item.id)?.quantity ?? 0;
                    return (
                      <View key={item.id} style={styles.menuRow}>
                        <RemoteImage
                          urlString={item.imageURL}
                          fallbackIcon={item.icon}
                          style={styles.menuImage}
                          iconSize={22}
                          borderRadius={12}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <Text style={styles.itemName}>{item.name}</Text>
                          {item.itemDescription ? (
                            <Text style={styles.itemDesc} numberOfLines={2}>
                              {item.itemDescription}
                            </Text>
                          ) : null}
                          <Text style={styles.itemPrice}>${item.price.toFixed(2)}</Text>
                        </View>
                        <View style={styles.qtyControl}>
                          {quantity > 0 ? (
                            <>
                              <Pressable onPress={() => decrement(item)} hitSlop={6}>
                                <Ionicons name="remove-circle" size={26} color={colors.orange} />
                              </Pressable>
                              <Text style={styles.qtyText}>{quantity}</Text>
                            </>
                          ) : null}
                          <Pressable onPress={() => add(item, restaurant.id)} hitSlop={6}>
                            <Ionicons name="add-circle" size={26} color={colors.orange} />
                          </Pressable>
                        </View>
                      </View>
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

      {/* Cart summary bar */}
      {restaurant.hasMenu && itemCount > 0 ? (
        <Pressable style={styles.cartBarWrap} onPress={goToCart}>
          <LinearGradient
            colors={accentGradient as unknown as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cartBar}
          >
            <Text style={styles.cartBarText}>
              {itemCount} item{itemCount === 1 ? '' : 's'}
            </Text>
            <Text style={styles.cartBarText}>View Cart • ${subtotal.toFixed(2)}</Text>
          </LinearGradient>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.offWhite },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  hero: { height: 240, width: '100%' },
  backButton: {
    position: 'absolute',
    top: 52,
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBlock: { paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLogo: { width: 52, height: 52, borderWidth: 1, borderColor: colors.gray200 },
  subMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  subMetaStrong: { fontSize: 12, fontWeight: '700', color: colors.navy },
  subMeta: { fontSize: 12, color: colors.textLight },
  dot: { fontSize: 12, color: colors.textLight },
  deliveryRow: { flexDirection: 'row', gap: 16, marginTop: 2 },
  deliveryMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  categoryTitle: { fontSize: 17, fontWeight: '700', color: colors.navy, paddingHorizontal: 16 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.white,
    borderRadius: 14,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  menuImage: { width: 56, height: 56 },
  itemName: { fontSize: 14, fontWeight: '700', color: colors.navy },
  itemDesc: { fontSize: 12, color: colors.textLight },
  itemPrice: { fontSize: 12, fontWeight: '600', color: colors.orange },
  qtyControl: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyText: { fontSize: 14, fontWeight: '700', minWidth: 16, textAlign: 'center', color: colors.navy },
  comingSoon: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 60, gap: 12 },
  comingSoonTitle: { fontSize: 17, fontWeight: '700', color: colors.navy },
  comingSoonBody: { fontSize: 14, color: colors.textLight, textAlign: 'center' },
  cartBarWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingBottom: 24 },
  cartBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
  },
  cartBarText: { color: colors.white, fontSize: 15, fontWeight: '600' },
});
