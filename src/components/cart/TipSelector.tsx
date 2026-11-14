import { Pressable, Text, TextInput, View } from 'react-native';
import { useTheme } from '../../theme/ThemeContext';
import { selectionFeedback } from '../../lib/haptics';
const presets = [0, 15, 18, 20, 25];
export function TipSelector({
  subtotal,
  percent,
  custom,
  onSelect,
  onCustom,
}: {
  subtotal: number;
  percent: number | null;
  custom: string;
  onSelect: (p: number | null) => void;
  onCustom: (v: string) => void;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: c.navy }}>
        A little thanks for your courier
      </Text>
      <Text style={{ fontSize: 12, color: c.textLight }}>
        100% of your tip goes to your courier.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {[...presets, null].map((p) => (
          <Pressable
            key={p ?? 'custom'}
            accessibilityRole="radio"
            accessibilityState={{ checked: percent === p }}
            onPress={() => {
              selectionFeedback();
              onSelect(p);
            }}
            style={{
              minWidth: 68,
              minHeight: 56,
              padding: 12,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: percent === p ? c.brandNavy : c.gray200,
              backgroundColor: percent === p ? c.brandNavy : c.white,
            }}
          >
            <Text
              style={{ fontSize: 13, fontWeight: '700', color: percent === p ? c.onBrand : c.navy }}
            >
              {p === null ? 'Custom' : p === 0 ? 'None' : `${p}%`}
            </Text>
            {p ? (
              <Text style={{ fontSize: 11, color: percent === p ? c.onBrandMuted : c.textLight }}>
                ${(Math.round(subtotal * p) / 100).toFixed(2)}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
      {percent === null ? (
        <TextInput
          accessibilityLabel="Custom driver tip in dollars"
          placeholder="Custom tip ($)"
          placeholderTextColor={c.textLight}
          keyboardType="decimal-pad"
          value={custom}
          onChangeText={onCustom}
          style={{
            minHeight: 52,
            padding: 14,
            borderRadius: 14,
            backgroundColor: c.gray100,
            fontSize: 16,
            color: c.navy,
          }}
        />
      ) : null}
    </View>
  );
}
