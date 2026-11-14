import { ScrollView, View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { DisplayText } from '../DisplayText';
import { MerchantCard } from './MerchantCard';
import { useTheme } from '../../theme/ThemeContext';
import type { Restaurant } from '../../types';
import type { CatalogMerchant } from '../../lib/consumerApi';
export function MerchantRail({
  title,
  subtitle,
  merchants,
  metadata,
}: {
  title: string;
  subtitle: string;
  merchants: Restaurant[];
  metadata: CatalogMerchant[];
}) {
  const router = useRouter();
  const { colors } = useTheme();
  if (!merchants.length) return null;
  return (
    <View style={{ gap: 16, marginTop: 26 }}>
      <View style={{ paddingHorizontal: 20, gap: 4 }}>
        <DisplayText size={29}>{title}</DisplayText>
        <Text style={{ fontSize: 13, color: colors.textLight }}>{subtitle}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 18 }}
      >
        {merchants.map((m) => (
          <MerchantCard
            key={m.id}
            merchant={m}
            metadata={metadata.find((x) => x.id === m.id)}
            compact
            onPress={() => router.push(`/restaurant/${m.id}`)}
          />
        ))}
      </ScrollView>
    </View>
  );
}
