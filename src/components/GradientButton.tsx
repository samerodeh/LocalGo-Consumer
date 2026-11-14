import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { selectionFeedback } from '../lib/haptics';
import { accentGradient, colors, radius } from '../theme/theme';

interface Props {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
}

/** Shared primary action using the accessible brand-orange gradient. */
export function GradientButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  height = 56,
  style,
}: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={() => { selectionFeedback(); onPress(); }}
      disabled={disabled || loading}
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }, style]}
    >
      <LinearGradient
        colors={accentGradient as unknown as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, { height }]}
      >
        {loading ? (
          <View style={styles.row}>
            <ActivityIndicator color={colors.white} />
          </View>
        ) : (
          <Text style={styles.label}>{title}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.orangeDark,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: colors.onBrand, fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
});
