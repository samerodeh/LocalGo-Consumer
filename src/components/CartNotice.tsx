import { Pressable, Text, View } from 'react-native';
import { useCartStore } from '../store/cartStore';
import { useTheme } from '../theme/ThemeContext';

export function CartNotice() {
  const { colors } = useTheme();
  const error = useCartStore(s => s.error);
  const busy = useCartStore(s => s.busy);
  const pending = useCartStore(s => s.pending);
  const retry = useCartStore(s => s.retryPending);
  const refresh = useCartStore(s => s.refresh);
  if (!error && !busy && !pending) return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 12, gap: 6 }}>
    <Text style={{ color: colors.navy }}>{busy ? 'Updating cart…' : error ?? 'A cart request needs reconciliation.'}</Text>
    {!busy && <Pressable onPress={() => { void (pending ? retry() : refresh()).catch(() => {}); }}>
      <Text style={{ color: colors.orange }}>{pending ? 'Retry pending request' : 'Refresh cart'}</Text>
    </Pressable>}
  </View>;
}
