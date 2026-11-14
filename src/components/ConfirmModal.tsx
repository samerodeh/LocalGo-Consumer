import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { radius } from '../theme/theme';
import { useTheme, type ThemePalette } from '../theme/ThemeContext';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button as a destructive (red) action. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A themed two-button confirmation dialog. Replaces `Alert.alert(..., buttons)`,
 * whose multi-button form silently no-ops on React Native Web — which is why the
 * old Sign Out / checkout confirms never fired in the browser. Works identically
 * on iOS, Android, and web.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        {/* Stop taps inside the card from dismissing. */}
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.cancel]} onPress={onCancel}>
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              style={[styles.button, destructive ? styles.destructive : styles.confirm]}
              onPress={onConfirm}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.overlay,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
    },
    card: {
      width: '100%',
      maxWidth: 380,
      backgroundColor: colors.white,
      borderRadius: radius.xl,
      padding: 28,
      gap: 12,
    },
    title: { fontSize: 22, fontWeight: '700', color: colors.navy },
    message: { fontSize: 15, color: colors.textLight, lineHeight: 23 },
    actions: { flexDirection: 'row', gap: 12, marginTop: 16 },
    button: {
      flex: 1,
      minHeight: 52,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 12,
    },
    cancel: { backgroundColor: colors.gray100 },
    cancelText: { fontSize: 15, fontWeight: '600', color: colors.navy },
    confirm: { backgroundColor: colors.orange },
    destructive: { backgroundColor: colors.danger },
    confirmText: { fontSize: 15, fontWeight: '600', color: colors.onBrand },
  });
