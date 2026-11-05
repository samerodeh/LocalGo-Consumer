import { Alert, Pressable, Text, View } from 'react-native';
import { useCartStore } from '../store/cartStore';
import { serverCartEnabled } from '../lib/serverCart';
import { cancelPendingCheckout } from '../lib/checkoutSession';
import { useTheme } from '../theme/ThemeContext';

export function CartNotice() {
  const { colors } = useTheme();
  const error = useCartStore(s => s.error);
  const busy = useCartStore(s => s.busy);
  const pending = useCartStore(s => s.pending);
  const retry = useCartStore(s => s.retryPending);
  const refresh = useCartStore(s => s.refresh);
  const owner = useCartStore(s => s.ownerEmail);
  if (!error && !busy && !pending && !serverCartEnabled) return null;
  return <View accessibilityLiveRegion="polite" style={{ padding: 12, gap: 6 }}>
    <Text style={{ color: colors.navy }}>{busy ? 'Updating cart…' : error ?? (pending ? 'A cart request needs reconciliation.' : 'Server cart connected.')}</Text>
    {!busy && <Pressable onPress={() => { void (pending ? retry() : refresh()).catch(() => {}); }}>
      <Text style={{ color: colors.orange }}>{pending ? 'Retry pending request' : 'Refresh cart'}</Text>
    </Pressable>}
    {serverCartEnabled && owner && !busy && <Pressable onPress={() => {
      Alert.alert('Cancel unfinished checkout?', 'Unpaid payment attempts will be canceled before the cart unlocks. Paid or processing orders cannot be canceled here.', [
        { text: 'Keep checkout', style: 'cancel' },
        { text: 'Cancel checkout', onPress: () => { void cancelPendingCheckout(owner).then(async () => {
          if (useCartStore.getState().ownerEmail === owner) await refresh();
        }).catch(error => { if (useCartStore.getState().ownerEmail === owner) Alert.alert('Checkout not released', error.message); }); } },
      ]);
    }}><Text style={{ color: colors.orange }}>Cancel unfinished checkout</Text></Pressable>}
  </View>;
}
