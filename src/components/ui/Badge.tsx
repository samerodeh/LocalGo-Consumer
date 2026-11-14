import { Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import type { IoniconName } from '../../types';
export function Badge({
  label,
  icon,
  tone = 'neutral',
}: {
  label: string;
  icon?: IoniconName;
  tone?: 'neutral' | 'accent' | 'dark';
}) {
  const { colors: c } = useTheme();
  const ink = tone === 'dark' ? c.onBrand : tone === 'accent' ? c.accentInk : c.navy;
  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor:
            tone === 'dark' ? c.brandNavy : tone === 'accent' ? c.accentSoft : c.gray100,
        },
      ]}
    >
      {icon ? <Ionicons name={icon} size={13} color={ink} /> : null}
      <Text style={[styles.text, { color: ink }]}>{label}</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  text: { fontSize: 12, fontWeight: '600' },
});
