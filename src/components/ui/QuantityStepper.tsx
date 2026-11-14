import { Pressable, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { selectionFeedback } from '../../lib/haptics';
export function QuantityStepper({
  quantity,
  onAdd,
  onRemove,
  min = 0,
  label = 'item',
}: {
  quantity: number;
  onAdd: () => void;
  onRemove: () => void;
  min?: number;
  label?: string;
}) {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.row, { backgroundColor: c.gray100 }]}>
      {quantity > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Decrease ${label} quantity`}
            disabled={quantity <= min}
            onPress={() => {
              selectionFeedback();
              onRemove();
            }}
            style={[styles.button, { opacity: quantity <= min ? 0.35 : 1 }]}
          >
            <Ionicons name="remove" size={20} color={c.navy} />
          </Pressable>
          <Text accessibilityLiveRegion="polite" style={[styles.number, { color: c.navy }]}>
            {quantity}
          </Text>
        </>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Add ${label}`}
        onPress={() => {
          selectionFeedback();
          onAdd();
        }}
        style={styles.button}
      >
        <Ionicons name="add" size={20} color={c.accentInk} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, alignSelf: 'flex-start' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  number: { fontSize: 14, fontWeight: '700', minWidth: 16, textAlign: 'center' },
});
