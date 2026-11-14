import { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { audioModule } from '../../lib/audio';
import { radius } from '../../theme/theme';
import { useTheme, type ThemePalette } from '../../theme/ThemeContext';
import type { Message } from '../../types';

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const formatDuration = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

/** Play/pause row for a voice-note bubble. Its own component so the
 *  useAudioPlayer hook only loads audio for messages actually rendered. */
type VoicePlayerProps = { url: string; durationSec: number | null; mine: boolean };

function VoicePlayer(props: VoicePlayerProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return audioModule ? (
    <AvailableVoicePlayer {...props} audio={audioModule} />
  ) : (
    <Text style={props.mine ? styles.textMine : styles.textTheirs}>Voice message unavailable</Text>
  );
}

function AvailableVoicePlayer({
  url,
  durationSec,
  mine,
  audio,
}: VoicePlayerProps & {
  audio: NonNullable<typeof audioModule>;
}) {
  const { useAudioPlayer, useAudioPlayerStatus } = audio;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const toggle = () => {
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || status.currentTime >= (status.duration || Infinity))
        player.seekTo(0);
      player.play();
    }
  };

  const remaining = status.duration > 0 ? status.duration - status.currentTime : (durationSec ?? 0);

  return (
    <Pressable
      onPress={toggle}
      style={styles.voiceRow}
      accessibilityRole="button"
      accessibilityLabel="Play voice message"
    >
      <Ionicons
        name={status.playing ? 'pause-circle' : 'play-circle'}
        size={32}
        color={mine ? '#FFFFFF' : colors.orange}
      />
      <View style={styles.voiceBars} pointerEvents="none">
        {Array.from({ length: 18 }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.voiceBar,
              { height: 6 + ((i * 37) % 14) },
              mine ? styles.voiceBarMine : styles.voiceBarTheirs,
            ]}
          />
        ))}
      </View>
      <Text style={mine ? styles.textMine : styles.textTheirs}>{formatDuration(remaining)}</Text>
    </Pressable>
  );
}

/** One chat bubble in a customer↔driver thread. `mine` puts it on the right
 *  in the accent color, matching the rest of the app's chat surfaces. */
export function ChatMessageBubble({ message, mine }: { message: Message; mine: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
        {message.imageUrl ? (
          <Image
            source={{ uri: message.imageUrl }}
            style={styles.photo}
            resizeMode="cover"
            accessibilityLabel="Photo"
          />
        ) : null}
        {message.audioUrl ? (
          <VoicePlayer url={message.audioUrl} durationSec={message.audioDurationSec} mine={mine} />
        ) : null}
        {message.body ? (
          <Text
            style={[
              mine ? styles.textMine : styles.textTheirs,
              message.imageUrl || message.audioUrl ? styles.captionSpacing : null,
            ]}
          >
            {message.body}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.time, mine ? styles.timeMine : styles.timeTheirs]}>
        {formatTime(message.createdAt)}
      </Text>
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    row: { marginVertical: 6, maxWidth: '82%' },
    rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
    rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
    bubble: { paddingHorizontal: 16, paddingVertical: 14, borderRadius: radius.lg },
    photo: { width: 220, height: 220, borderRadius: radius.md, backgroundColor: colors.gray100 },
    captionSpacing: { marginTop: 8 },
    bubbleMine: { backgroundColor: colors.buttonStart, borderBottomRightRadius: 6 },
    bubbleTheirs: {
      backgroundColor: colors.white,
      borderBottomLeftRadius: 6,
      borderWidth: 1,
      borderColor: colors.gray200,
    },
    textMine: { fontSize: 15, lineHeight: 21, color: '#FFFFFF' },
    textTheirs: { fontSize: 15, lineHeight: 21, color: colors.navy },
    time: { fontSize: 11, marginTop: 6, marginHorizontal: 4, color: colors.textLight },
    timeMine: { textAlign: 'right' },
    timeTheirs: { textAlign: 'left' },
    voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 170 },
    voiceBars: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2, height: 20 },
    voiceBar: { width: 3, borderRadius: 2 },
    voiceBarMine: { backgroundColor: 'rgba(255,255,255,0.6)' },
    voiceBarTheirs: { backgroundColor: colors.gray300 },
  });
