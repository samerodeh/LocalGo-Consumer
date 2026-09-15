import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, type ThemePalette } from '../theme/ThemeContext';
import { statusPresentation } from '../lib/orderFormat';
import type { OrderRecord } from '../types';

/** Where an order got to, as a pill. One component so the same order shows the
 *  same state in the list, on the detail screen, and on the confirmation. */
export function OrderStatusBadge({ order }: { order: OrderRecord }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { label, tone, icon } = statusPresentation(order);

  // Tinted backgrounds are computed from the accent rather than stored as
  // tokens, so the badge works unchanged under both themes.
  const palette: Record<typeof tone, { fg: string; bg: string }> = {
    orange: { fg: colors.orange, bg: 'rgba(249,115,22,0.14)' },
    green: { fg: '#15803D', bg: 'rgba(34,197,94,0.16)' },
    navy: { fg: colors.navy, bg: colors.gray100 },
    muted: { fg: colors.textLight, bg: colors.gray100 },
  };
  const { fg, bg } = palette[tone];

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={13} color={fg} />
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const makeStyles = (_colors: ThemePalette) =>
  StyleSheet.create({
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 999,
      alignSelf: 'flex-start',
    },
    label: { fontSize: 12, fontWeight: '700' },
  });
