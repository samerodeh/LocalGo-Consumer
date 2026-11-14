import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Older development clients may not include ExpoAudio. Importing expo-audio
// eagerly throws in those clients and prevents the chat route from loading.
// Web provides its own audio implementation and needs no native module.
export const audioModule: typeof import('expo-audio') | null =
  Platform.OS === 'web' || requireOptionalNativeModule('ExpoAudio')
    ? require('expo-audio')
    : null;
