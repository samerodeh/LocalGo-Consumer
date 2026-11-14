// Chat attachments: picking/uploading a photo, and uploading a recorded voice
// note. Mirrors the driver app's proof-photo flow (orderPhotos.ts) — same
// upload-to-public-bucket pattern — but usable by either chat participant for
// an in-conversation attachment rather than a delivery-status photo.
import { Platform } from 'react-native';
import { imagePickerModule as ImagePicker } from './imagePicker';
import { supabase } from './supabase';

/** Opens the photo library and returns the picked asset's local uri, or null
 *  if the user cancels or denies permission. Library (not camera) so it works
 *  the same on every platform, including the web preview. */
export async function pickChatImage(): Promise<string | null> {
  if (!ImagePicker) return null;
  if (Platform.OS === 'ios') {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.5,
  });
  if (result.canceled || result.assets.length === 0) return null;
  return result.assets[0].uri;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  m4a: 'audio/m4a',
  webm: 'audio/webm',
  '3gp': 'audio/3gpp',
  mp4: 'audio/mp4',
  caf: 'audio/x-caf',
};

function extOf(uri: string): string {
  const match = /\.([a-zA-Z0-9]+)(?:\?.*)?$/.exec(uri);
  return match ? match[1].toLowerCase() : 'm4a';
}

async function uploadToBucket(
  bucket: string,
  orderId: string,
  uri: string,
  ext: string,
  contentType: string,
): Promise<string | null> {
  if (!supabase) return null;
  const path = `${orderId}/${Date.now()}.${ext}`;
  const arrayBuffer = await fetch(uri).then((r) => r.arrayBuffer());
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, arrayBuffer, { contentType, upsert: true });
  if (error) {
    console.warn(`[chatMedia] upload to ${bucket} failed:`, error.message);
    return null;
  }
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Uploads a chat-attached photo to the shared public `order-photos` bucket. */
export async function uploadChatImage(orderId: string, uri: string): Promise<string | null> {
  return uploadToBucket('order-photos', orderId, uri, 'jpg', 'image/jpeg');
}

/** Uploads a recorded voice note to the public `chat-audio` bucket. The file
 *  extension/content-type follow whatever the recorder actually produced
 *  (`.m4a` on iOS/Android, `.webm` on web via expo-audio's RecordingPresets). */
export async function uploadChatAudio(orderId: string, uri: string): Promise<string | null> {
  const ext = extOf(uri);
  return uploadToBucket('chat-audio', orderId, uri, ext, CONTENT_TYPE_BY_EXT[ext] ?? 'audio/m4a');
}
