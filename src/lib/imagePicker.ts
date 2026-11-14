import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

// Photo attachments are optional in development clients built without the
// image-picker module. The web implementation does not use a native module.
export const imagePickerModule: typeof import('expo-image-picker') | null =
  Platform.OS === 'web' || requireOptionalNativeModule('ExponentImagePicker')
    ? require('expo-image-picker')
    : null;
