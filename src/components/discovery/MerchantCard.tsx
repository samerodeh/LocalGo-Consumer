import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/theme';
import { RemoteImage } from '../RemoteImage';
import { Badge } from '../ui/Badge';
import type { Restaurant } from '../../types';
import type { MerchantMetadata } from '../../types/commerce';
export function MerchantCard({
  merchant,
  metadata,
  onPress,
  compact = false,
}: {
  merchant: Restaurant;
  metadata?: MerchantMetadata;
  onPress: () => void;
  compact?: boolean;
}) {
  const { colors: c } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Browse ${merchant.name}`}
      style={({ pressed }) => [
        styles.card,
        compact && styles.compact,
        { opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <View>
        <RemoteImage
          urlString={merchant.heroImageURL}
          fallbackIcon={merchant.heroIcon}
          style={[styles.hero, { height: compact ? 142 : 178 }]}
          borderRadius={radius.lg}
          priority="high"
        />
        <View style={styles.time}>
          <Badge label={merchant.deliveryTime} icon="time-outline" />
        </View>
        {metadata?.topLocal ? (
          <View style={styles.local}>
            <Badge label="Top local" tone="dark" />
          </View>
        ) : null}
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.name, { color: c.navy }]}>
            {merchant.name}
          </Text>
          {metadata?.verified ? (
            <Ionicons name="checkmark-circle" size={16} color={c.accentInk} />
          ) : null}
          {metadata?.rating != null ? (
            <Text style={{ fontSize: 12, fontWeight: '700', color: c.navy }}>
              ★ {metadata.rating.toFixed(1)}{' '}
              <Text style={{ color: c.textLight, fontWeight: '400' }}>
                ({metadata.reviewCount})
              </Text>
            </Text>
          ) : null}
        </View>
        <Text style={{ fontSize: 13, color: c.textLight }} numberOfLines={1}>
          {merchant.cuisine}
        </Text>
        <View style={styles.meta}>
          <Text style={{ fontSize: 12, color: c.textLight }}>{merchant.deliveryFee}</Text>
          {merchant.distance ? (
            <>
              <Text style={{ color: c.gray300 }}>·</Text>
              <Text style={{ fontSize: 12, color: c.textLight }}>{merchant.distance} away</Text>
            </>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: { gap: 12 },
  compact: { width: 256 },
  hero: { width: '100%' },
  time: { position: 'absolute', right: 10, bottom: 10 },
  local: { position: 'absolute', left: 10, top: 10 },
  body: { gap: 6, paddingHorizontal: 2 },
  titleRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  name: { fontSize: 18, fontWeight: '800', flex: 1 },
  meta: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
