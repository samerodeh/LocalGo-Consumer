import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import type { IoniconName } from '../../types';

/** Keyboard/screen-reader alternative to dragging the entrance pin. */
export function PinNudges({
  point,
  onChange,
}: {
  point: { latitude: number; longitude: number };
  onChange: (point: { latitude: number; longitude: number }) => void;
}) {
  const { colors: c } = useTheme();
  const latitudeStep = 20 / 111320;
  const longitudeStep = 20 / (111320 * Math.max(0.1, Math.cos((point.latitude * Math.PI) / 180)));
  const directions: { label: string; icon: IoniconName; lat: number; lon: number }[] = [
    { label: 'north', icon: 'arrow-up', lat: latitudeStep, lon: 0 },
    { label: 'west', icon: 'arrow-back', lat: 0, lon: -longitudeStep },
    { label: 'east', icon: 'arrow-forward', lat: 0, lon: longitudeStep },
    { label: 'south', icon: 'arrow-down', lat: -latitudeStep, lon: 0 },
  ];
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 12, color: c.textLight, lineHeight: 19 }}>
        Or move your entrance pin about 20 metres at a time:
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {directions.map((d) => (
          <Pressable
            key={d.label}
            accessibilityRole="button"
            accessibilityLabel={`Move delivery pin ${d.label} about 20 metres`}
            onPress={() =>
              onChange({ latitude: point.latitude + d.lat, longitude: point.longitude + d.lon })
            }
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              backgroundColor: c.gray100,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={d.icon} size={22} color={c.navy} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
