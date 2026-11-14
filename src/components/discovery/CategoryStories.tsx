import { ScrollView, Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import type { MerchantCategory } from '../../types/commerce';
import type { IoniconName } from '../../types';
import { selectionFeedback } from '../../lib/haptics';
const categories: { id: MerchantCategory; label: string; icon: IoniconName }[] = [
  { id: 'restaurants', label: 'Restaurants', icon: 'restaurant-outline' },
  { id: 'grocery', label: 'Grocery', icon: 'basket-outline' },
  { id: 'convenience', label: 'Convenience', icon: 'storefront-outline' },
  { id: 'specialty', label: 'Local finds', icon: 'sparkles-outline' },
  { id: 'pharmacy', label: 'Pharmacy', icon: 'medkit-outline' },
];
export function CategoryStories({
  selected,
  available,
  onSelect,
}: {
  selected: MerchantCategory;
  available: Set<MerchantCategory>;
  onSelect: (id: MerchantCategory) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.rail}
    >
      {categories.map((x) => {
        const active = selected === x.id;
        const enabled = available.has(x.id);
        return (
          <Pressable
            key={x.id}
            disabled={!enabled}
            accessibilityRole="radio"
            accessibilityLabel={`${x.label}${enabled ? '' : ', coming soon'}`}
            accessibilityState={{ checked: active, disabled: !enabled }}
            onPress={() => {
              selectionFeedback();
              onSelect(x.id);
            }}
            style={styles.item}
          >
            <View
              style={[
                styles.circle,
                {
                  backgroundColor: active ? c.brandNavy : c.gray100,
                  borderColor: active ? c.brandNavy : c.gray200,
                  opacity: enabled ? 1 : 0.5,
                },
              ]}
            >
              <Ionicons name={x.icon} color={active ? c.onBrand : c.navy} size={26} />
            </View>
            <Text
              style={{
                fontSize: 11,
                fontWeight: active ? '800' : '500',
                color: enabled ? c.navy : c.textLight,
              }}
            >
              {x.label}
            </Text>
            {!enabled ? <Text style={{ fontSize: 9, color: c.textLight }}>Soon</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  rail: { paddingHorizontal: 20, gap: 16, paddingVertical: 20 },
  item: { alignItems: 'center', gap: 8, width: 70 },
  circle: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
