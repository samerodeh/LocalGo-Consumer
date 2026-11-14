import { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Skeleton } from './ui/Skeleton';
import { useTheme } from '../theme/ThemeContext';
import type { IoniconName } from '../types';

interface Props {
  urlString: string | null;
  fallbackIcon: IoniconName;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
  borderRadius?: number;
  /** Bump for above-the-fold imagery (restaurant heroes); defaults to normal. */
  priority?: 'low' | 'normal' | 'high';
}

/**
 * Async remote image with a graceful icon fallback — mirrors the SwiftUI RemoteImage.
 *
 * Backed by expo-image rather than RN's Image: every URL is cached
 * memory+disk (`cachePolicy`), so each photo downloads once per install
 * instead of once per mount — the difference between a spinner-y list and an
 * instant one on Android, where bare RN Image has no disk cache at all. The
 * icon tile renders underneath and the photo fades in over it, so loading,
 * loaded, and failed states all look intentional without extra state.
 */
export function RemoteImage({
  urlString,
  fallbackIcon,
  style,
  iconSize = 24,
  borderRadius = 0,
  priority = 'normal',
}: Props) {
  const { colors } = useTheme();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(Boolean(urlString));
  useEffect(() => { setFailed(false); setLoading(Boolean(urlString)); }, [urlString]);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.gray100, borderRadius },
        style,
      ]}
    >
      <Ionicons name={fallbackIcon} size={iconSize} color={colors.orange} />
      {urlString && !failed ? (
        <Image
          source={{ uri: urlString }}
          style={[StyleSheet.absoluteFill, { borderRadius }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          priority={priority}
          transition={150}
          recyclingKey={urlString}
          onLoad={() => setLoading(false)}
          onError={() => { setFailed(true); setLoading(false); }}
        />
      ) : null}
      {loading && !failed ? <Skeleton style={[StyleSheet.absoluteFill, { borderRadius }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});
