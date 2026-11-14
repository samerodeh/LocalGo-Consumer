import { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../src/theme/theme';
import { useTheme, type ThemePalette } from '../src/theme/ThemeContext';
import { DisplayText } from '../src/components/DisplayText';
import { GradientButton } from '../src/components/GradientButton';
import { useAuthStore } from '../src/store/authStore';

/**
 * Reached only via the deep link a password-reset email opens
 * (localgo://reset-password#access_token=...). By the time this screen
 * mounts, the root layout's deep-link handler has already exchanged those
 * tokens for a live recovery session via beginPasswordRecovery(), so all this
 * screen does is collect + submit the new password against that session.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { resetPassword, isLoggedIn, isLoading, errorMessage, clearError } = useAuthStore();

  const handleSubmit = async () => {
    const success = await resetPassword(newPassword, confirmPassword);
    if (success) {
      Alert.alert('Password Reset', 'Your password has been updated.', [
        { text: 'OK', onPress: () => router.replace(isLoggedIn ? '/(tabs)' : '/(auth)/login') },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={colors.orange} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <DisplayText size={34} weight="heavy">
              Set New Password
            </DisplayText>
            <Text style={styles.subtitle}>Choose a new password for your account.</Text>
          </View>

          <View style={styles.fields}>
            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput
              accessibilityLabel="New password"
              placeholder="New password"
              placeholderTextColor={colors.gray400}
              value={newPassword}
              onChangeText={(t) => {
                setNewPassword(t);
                if (errorMessage) clearError();
              }}
              secureTextEntry
              autoComplete="new-password"
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <TextInput
              accessibilityLabel="Confirm new password"
              placeholder="Confirm new password"
              placeholderTextColor={colors.gray400}
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                if (errorMessage) clearError();
              }}
              secureTextEntry
              autoComplete="new-password"
              style={styles.input}
            />
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
          </View>

          <GradientButton
            title="Reset Password"
            loading={isLoading}
            onPress={handleSubmit}
            style={styles.cta}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.navy, marginBottom: -4 },
    safe: {
      flex: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      backgroundColor: colors.offWhite,
    },
    topBar: { paddingHorizontal: 24, paddingTop: 12, minHeight: 48 },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
    header: { paddingTop: 28, paddingBottom: 32 },
    subtitle: { color: colors.textLight, fontSize: 15, marginTop: 10, lineHeight: 23 },
    fields: { gap: 14 },
    input: {
      backgroundColor: colors.white,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      padding: 18,
      minHeight: 56,
      fontSize: 16,
      color: colors.navy,
    },
    error: { color: colors.danger, fontSize: 13 },
    cta: { marginTop: 24 },
  });
