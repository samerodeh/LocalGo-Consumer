import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { BottomSheet } from '../ui/BottomSheet';
import { useAddressStore, addressDisplayName } from '../../store/addressStore';
import { useTheme } from '../../theme/ThemeContext';
import { selectionFeedback } from '../../lib/haptics';
import type { FulfillmentMode } from '../../types/commerce';
export function AddressPickerSheet({
  visible,
  onClose,
  mode,
  onModeChange,
  pickupAvailable,
}: {
  visible: boolean;
  onClose: () => void;
  mode: FulfillmentMode;
  onModeChange: (mode: FulfillmentMode) => void;
  pickupAvailable: boolean;
}) {
  const { colors: c } = useTheme();
  const router = useRouter();
  const addresses = useAddressStore((s) => s.allAddresses);
  const selected = useAddressStore((s) => s.defaultAddress);
  const choose = useAddressStore((s) => s.setDefault);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Your neighbourhood"
      subtitle="Choose where your next local favourite is headed."
    >
      <View
        style={{ flexDirection: 'row', padding: 4, borderRadius: 16, backgroundColor: c.gray100 }}
      >
        {(['delivery', 'pickup'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="radio"
            accessibilityState={{
              checked: mode === value,
              disabled: value === 'pickup' && !pickupAvailable,
            }}
            disabled={value === 'pickup' && !pickupAvailable}
            onPress={() => {
              selectionFeedback();
              onModeChange(value);
            }}
            style={{
              flex: 1,
              padding: 14,
              alignItems: 'center',
              borderRadius: 12,
              backgroundColor: mode === value ? c.white : 'transparent',
              opacity: value === 'pickup' && !pickupAvailable ? 0.4 : 1,
            }}
          >
            <Text style={{ fontWeight: '700', color: c.navy }}>
              {value === 'delivery' ? 'Delivery' : 'Pickup'}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === 'pickup' ? (
        <Text style={{ color: c.textLight, lineHeight: 21 }}>
          Collect your order directly from a participating store. Choose your pickup store below.
        </Text>
      ) : null}
      {addresses.map((a) => (
        <Pressable
          key={a.id}
          disabled={busy !== null}
          accessibilityRole="radio"
          accessibilityState={{ checked: a.id === selected?.id }}
          onPress={async () => {
            setBusy(a.id);
            setError('');
            try {
              await choose(a.id);
              selectionFeedback();
              onClose();
            } catch {
              setError('Could not switch addresses. Please try again.');
            } finally {
              setBusy(null);
            }
          }}
          style={{
            flexDirection: 'row',
            gap: 14,
            paddingVertical: 18,
            borderBottomWidth: 1,
            borderBottomColor: c.gray200,
            alignItems: 'center',
          }}
        >
          <Ionicons
            name={a.personalLabel === 'Work' ? 'briefcase-outline' : 'location-outline'}
            size={23}
            color={c.navy}
          />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: c.navy, fontWeight: '700', fontSize: 16 }}>
              {addressDisplayName(a)}
            </Text>
            <Text style={{ color: c.textLight, fontSize: 13 }}>{a.addressLine}</Text>
          </View>
          {busy === a.id ? (
            <ActivityIndicator color={c.orange} />
          ) : (
            <Ionicons
              name={a.id === selected?.id ? 'checkmark-circle' : 'ellipse-outline'}
              size={23}
              color={a.id === selected?.id ? c.orange : c.gray300}
            />
          )}
        </Pressable>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.danger }}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          onClose();
          router.push('/address');
        }}
        style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}
      >
        <Ionicons name="add-circle-outline" size={24} color={c.accentInk} />
        <Text style={{ color: c.accentInk, fontWeight: '700' }}>
          Add or manage delivery addresses
        </Text>
      </Pressable>
    </BottomSheet>
  );
}
