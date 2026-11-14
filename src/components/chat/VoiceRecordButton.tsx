import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { audioModule } from '../../lib/audio';
import { useTheme, type ThemePalette } from '../../theme/ThemeContext';
import { useChatStore } from '../../store/chatStore';
import { uploadChatAudio } from '../../lib/chatMedia';

const formatDuration = (ms: number) => {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/** Tap to start recording a voice note, tap again to stop — it uploads and
 *  sends immediately (no separate confirm step, matching the app's other
 *  instant-send attachment flow — see the driver's proof-photo capture). */
export function VoiceRecordButton({ orderId }: { orderId: string }) {
  const { colors } = useTheme();
  return audioModule ? (
    <AvailableVoiceRecordButton orderId={orderId} audio={audioModule} />
  ) : (
    <Ionicons
      name="mic-off-outline"
      size={24}
      color={colors.gray400}
      accessibilityLabel="Voice recording unavailable"
    />
  );
}

function AvailableVoiceRecordButton({ orderId, audio }: {
  orderId: string;
  audio: NonNullable<typeof audioModule>;
}) {
  const {
    RecordingPresets,
    requestRecordingPermissionsAsync,
    setAudioModeAsync,
    useAudioRecorder,
    useAudioRecorderState,
  } = audio;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 200);
  const [busy, setBusy] = useState(false);
  const send = useChatStore((s) => s.send);

  const start = async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) return;
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    } catch {
      // Not supported on every platform (e.g. some web browsers) — recording
      // itself may still work without an explicit mode switch.
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const stopAndSend = async () => {
    const durationSec = state.durationMillis / 1000;
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) return;
    setBusy(true);
    try {
      const url = await uploadChatAudio(orderId, uri);
      if (url) await send('', { audioUrl: url, audioDurationSec: Math.round(durationSec) });
    } finally {
      setBusy(false);
    }
  };

  if (state.isRecording) {
    return (
      <Pressable
        onPress={() => void stopAndSend()}
        disabled={busy}
        style={styles.recordingPill}
        accessibilityRole="button"
        accessibilityLabel="Stop and send voice message"
      >
        <View style={styles.recordingDot} />
        <Text style={styles.recordingTime}>{formatDuration(state.durationMillis)}</Text>
        <Ionicons name="checkmark-circle" size={20} color={colors.orange} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => void start()}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Record a voice message"
    >
      <Ionicons name="mic" size={24} color={busy ? colors.gray400 : colors.orange} />
    </Pressable>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    recordingPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.gray100,
      borderRadius: 20,
      paddingHorizontal: 10,
      height: 36,
    },
    recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
    recordingTime: { fontSize: 13, fontWeight: '600', color: colors.navy, minWidth: 30 },
  });
