import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
/** Feedback is best effort; unavailable hardware must never block an action. */
export function selectionFeedback() {
  if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
}
