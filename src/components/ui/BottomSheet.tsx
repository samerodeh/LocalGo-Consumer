import type { ReactNode } from 'react';
import {
  Modal,
  Pressable,
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeContext';
import { radius } from '../../theme/theme';
import { DisplayText } from '../DisplayText';
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  interactionDisabled = false,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  interactionDisabled?: boolean;
}) {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!interactionDisabled) onClose();
      }}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={[styles.backdrop, { backgroundColor: c.overlay }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          disabled={interactionDisabled}
          accessibilityRole="button"
          accessibilityLabel="Close drawer"
        />
        <View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            { backgroundColor: c.white, paddingBottom: Math.max(insets.bottom, 16) },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: c.gray300 }]} />
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 6 }}>
              <DisplayText size={30} accessibilityRole="header">
                {title}
              </DisplayText>
              {subtitle ? (
                <Text style={{ color: c.textLight, fontSize: 14, lineHeight: 21 }}>{subtitle}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              disabled={interactionDisabled}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={[styles.close, { backgroundColor: c.gray100 }]}
            >
              <Ionicons name="close" size={22} color={c.navy} />
            </Pressable>
          </View>
          <ScrollView
            pointerEvents={interactionDisabled ? 'none' : 'auto'}
            accessibilityElementsHidden={interactionDisabled}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View style={[styles.footer, { borderTopColor: c.gray200 }]}>{footer}</View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '90%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  handle: { height: 4, width: 36, borderRadius: 2, alignSelf: 'center', marginTop: 10 },
  header: { flexDirection: 'row', gap: 16, padding: 24, alignItems: 'flex-start' },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 24, paddingBottom: 24, gap: 12 },
  footer: { borderTopWidth: 1, padding: 20 },
});
