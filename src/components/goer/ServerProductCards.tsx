import { Pressable, Text, View } from 'react-native';
import type { ServerProduct } from '../../goer/types';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/theme';
import { useCartStore } from '../../store/cartStore';
import { DisplayText } from '../DisplayText';

export function ServerProductCards({ items }: { items: ServerProduct[] }) {
  const { colors } = useTheme();
  return <View style={{ gap: 8, paddingHorizontal: 16 }}>
    {items.map((item, index) => <View key={item.product_id} style={{ padding: 12, gap: 5,
      backgroundColor: colors.white, borderRadius: radius.md }}>
      <DisplayText size={18} weight="bold">{index + 1}. {item.name}</DisplayText>
      <Text style={{ color: colors.navy }}>{item.display_price} {item.currency}</Text>
      {item.description ? <Text style={{ color: colors.textLight }}>{item.description}</Text> : null}
      <Pressable onPress={() => { void useCartStore.getState().mutate('add', item.product_id, 1).catch(() => {}); }}>
        <Text style={{ color: colors.orange }}>Add one to cart</Text>
      </Pressable>
    </View>)}
  </View>;
}
