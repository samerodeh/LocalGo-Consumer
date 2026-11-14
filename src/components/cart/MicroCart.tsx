import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCartStore } from '../../store/cartStore';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/theme';
export function MicroCart({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  const count = useCartStore((s) => s.itemCount());
  const subtotal = useCartStore((s) => s.subtotal());
  const { colors: c } = useTheme();
  if (!count) return null;
  return (
    <View style={[styles.wrap, { backgroundColor: c.offWhite }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View cart, ${count} items, food subtotal $${subtotal.toFixed(2)}`}
        onPress={onPress ?? (() => router.push('/(tabs)/cart'))}
        style={({ pressed }) => [
          styles.bar,
          { backgroundColor: c.brandNavy, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <View style={[styles.count, { backgroundColor: c.brandLine }]}>
          <Text style={{ color: c.onBrand, fontWeight: '800' }}>{count}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.onBrand, fontWeight: '700', fontSize: 15 }}>View your bag</Text>
          <Text style={{ color: c.onBrandMuted, fontSize: 11 }}>
            Food subtotal · fees at checkout
          </Text>
        </View>
        <Text style={{ color: c.onBrand, fontWeight: '800', fontSize: 16 }}>
          ${subtotal.toFixed(2)}
        </Text>
        <Ionicons name="arrow-forward" size={20} color={c.onBrand} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 10 },
  bar: {
    minHeight: 66,
    padding: 14,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  count: { width: 30, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
