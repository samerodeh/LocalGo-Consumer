import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { accentGradient, radius } from '../../theme/theme';
import { useTheme, type ThemePalette } from '../../theme/ThemeContext';
import { DisplayText } from '../DisplayText';
import { ConfirmModal } from '../ConfirmModal';
import { goerOwnerGeneration, useGoerStore } from '../../goer/goerStore';
import { authenticatedGoerEnabled } from '../../goer/authenticatedClient';
import { MAX_UI_MESSAGES } from '../../goer/config';
import { sendGoerMessage } from '../../goer/send';
import type { GoerMessage } from '../../goer/types';
import { AgentBadge } from './AgentBadge';
import { MessageView } from './MessageView';
import { MessageBubble } from './MessageBubble';
import { TypingIndicator } from './TypingIndicator';
import { GoerHistory } from './GoerHistory';

/**
 * The Goer chat surface. Mounted once (in the tabs layout) and presented as a
 * bottom sheet on phones or a floating bottom-right panel on wide screens —
 * the standard in-app assistant pattern.
 */
export function GoerSheet() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWide = width >= 768;

  const isOpen = useGoerStore((s) => s.isOpen);
  const close = useGoerStore((s) => s.close);
  const uiMessages = useGoerStore((s) => s.uiMessages);
  const isStreaming = useGoerStore((s) => s.isStreaming);
  const isHistoryLoading = useGoerStore((s) => s.isHistoryLoading);
  const pendingMessage = useGoerStore((s) => s.pendingMessage);
  const generation = goerOwnerGeneration();
  const streamingText = useGoerStore((s) => s.streamingText);
  const activeAgent = useGoerStore((s) => s.activeAgent);
  const mode = useGoerStore((s) => s.mode);
  const clearChat = useGoerStore((s) => s.clearChat);

  const [input, setInput] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const blocked = isStreaming || isHistoryLoading || Boolean(pendingMessage) || showHistory;
  useEffect(() => {
    setInput(''); setConfirmClear(false); setShowHistory(false);
  }, [generation]);

  // Inverted list wants newest-first data.
  const reversed = useMemo(() => [...uiMessages].reverse(), [uiMessages]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || blocked) return;
    setInput('');
    void sendGoerMessage(text);
  }, [input, blocked]);

  const renderItem = useCallback(
    ({ item }: { item: GoerMessage }) => <MessageView message={item} />,
    [],
  );

  return (
    <Modal visible={isOpen} transparent animationType="slide" onRequestClose={close}>
      <View style={[styles.overlay, isWide && styles.overlayWide]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close chat" />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[styles.sheet, isWide ? styles.sheetWide : styles.sheetNarrow]}
        >
          {/* Header */}
          <View style={styles.header}>
            <LinearGradient
              colors={accentGradient as unknown as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.avatar}
            >
              <Ionicons name="sparkles" size={16} color="#FFFFFF" />
            </LinearGradient>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <DisplayText size={20} weight="bold" color={colors.navy}>
                  Goer
                </DisplayText>
                {mode === 'fallback' ? (
                  <Ionicons name="cloud-offline-outline" size={14} color={colors.gray400} />
                ) : null}
              </View>
              <AgentBadge agent={activeAgent} />
            </View>
            {authenticatedGoerEnabled ? <Pressable
              onPress={() => setShowHistory(value => !value)} disabled={isStreaming || isHistoryLoading}
              hitSlop={8} accessibilityRole="button" accessibilityLabel="Saved conversations"
              style={styles.headerButton}>
              <Ionicons name="time-outline" size={18} color={colors.textLight} />
            </Pressable> : null}
            <Pressable
              disabled={blocked}
              onPress={() => setConfirmClear(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={authenticatedGoerEnabled ? 'New conversation' : 'Clear conversation'}
              style={styles.headerButton}
            >
              <Ionicons name={authenticatedGoerEnabled ? 'add-outline' : 'trash-outline'} size={18} color={colors.textLight} />
            </Pressable>
            <Pressable
              onPress={close}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close chat"
              style={styles.headerButton}
            >
              <Ionicons name="close" size={20} color={colors.navy} />
            </Pressable>
          </View>

          {authenticatedGoerEnabled ? <Text accessibilityLiveRegion="polite"
            style={{ paddingHorizontal: 16, color: colors.textLight }}>
            {isHistoryLoading ? 'Loading account history…' : `Account history · latest ${MAX_UI_MESSAGES} messages`}
          </Text> : null}
          {pendingMessage && !showHistory ? <Pressable accessibilityRole="button"
            disabled={isStreaming || isHistoryLoading}
            onPress={() => { void sendGoerMessage(pendingMessage, true); }} style={{ padding: 12 }}>
            <Text style={{ color: colors.orange }}>Retry pending turn</Text>
          </Pressable> : null}
          {/* Transcript */}
          {showHistory ? <GoerHistory key={generation} onClose={() => setShowHistory(false)} /> : <FlatList
            inverted
            data={reversed}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.transcript}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            // Inverted list: the header component sits at the visual bottom,
            // right where the in-progress reply belongs.
            ListHeaderComponent={
              isStreaming ? (
                streamingText.length > 0 ? (
                  <MessageBubble role="assistant" text={streamingText} streaming />
                ) : (
                  <TypingIndicator agent={activeAgent} />
                )
              ) : null
            }
          />}

          {/* Composer */}
          <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={handleSend}
              editable={!blocked}
              maxLength={4000}
              placeholder={pendingMessage ? 'Retry the pending turn first' : 'Ask Goer anything…'}
              placeholderTextColor={colors.gray400}
              style={styles.input}
              returnKeyType="send"
              submitBehavior="submit"
              autoCapitalize="sentences"
              accessibilityLabel="Message Goer"
            />
            <Pressable
              onPress={handleSend}
              disabled={blocked || input.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Send message"
              style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
            >
              <LinearGradient
                colors={accentGradient as unknown as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[
                  styles.sendButton,
                  (blocked || input.trim().length === 0) && { opacity: 0.4 },
                ]}
              >
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              </LinearGradient>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>

      <ConfirmModal
        visible={confirmClear}
        title={authenticatedGoerEnabled ? 'New conversation?' : 'Clear conversation?'}
        message={authenticatedGoerEnabled ? 'Start fresh. This conversation stays in your account history.'
          : 'Goer will clear this chat and start fresh.'}
        confirmLabel={authenticatedGoerEnabled ? 'Start new' : 'Clear'}
        cancelLabel="Keep it"
        destructive={!authenticatedGoerEnabled}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          clearChat();
        }}
      />
    </Modal>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(2,6,23,0.45)',
      justifyContent: 'flex-end',
    },
    overlayWide: { alignItems: 'flex-end', padding: 20 },
    sheet: {
      backgroundColor: colors.offWhite,
      overflow: 'hidden',
    },
    sheetNarrow: {
      height: '88%',
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
    },
    sheetWide: {
      width: 420,
      height: '92%',
      borderRadius: radius.xl,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 12 },
      elevation: 12,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.white,
      borderBottomWidth: 1,
      borderBottomColor: colors.gray200,
    },
    avatar: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.gray100,
    },
    transcript: { paddingHorizontal: 14, paddingVertical: 12 },
    composer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingTop: 10,
      backgroundColor: colors.white,
      borderTopWidth: 1,
      borderTopColor: colors.gray200,
    },
    input: {
      flex: 1,
      height: 44,
      borderRadius: radius.xl,
      backgroundColor: colors.gray100,
      paddingHorizontal: 16,
      fontSize: 15,
      color: colors.navy,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
