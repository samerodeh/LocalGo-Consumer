import { useMemo, useState } from 'react';
import {
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
import { radius } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { GradientButton } from '../../src/components/GradientButton';
import { useAuthStore } from '../../src/store/authStore';

export default function SignUpScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { signUp, isLoading, errorMessage, clearError } = useAuthStore();

  const onChange = (setter: (v: string) => void) => (t: string) => {
    setter(t);
    if (errorMessage) clearError();
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
              Create Account
            </DisplayText>
            <Text style={styles.subtitle}>Start ordering in minutes.</Text>
          </View>

          <View style={styles.fields}>
            <View style={styles.nameRow}>
              <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                <Text style={styles.fieldLabel}>First Name</Text>
                <TextInput
                  accessibilityLabel="First Name"
                  placeholder="First Name"
                  placeholderTextColor={colors.gray400}
                  value={firstName}
                  onChangeText={onChange(setFirstName)}
                  autoComplete="name-given"
                  style={styles.input}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                <Text style={styles.fieldLabel}>Last Name</Text>
                <TextInput
                  accessibilityLabel="Last Name"
                  placeholder="Last Name"
                  placeholderTextColor={colors.gray400}
                  value={lastName}
                  onChangeText={onChange(setLastName)}
                  autoComplete="name-family"
                  style={styles.input}
                />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              accessibilityLabel="Email"
              placeholder="Email"
              placeholderTextColor={colors.gray400}
              value={email}
              onChangeText={onChange(setEmail)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
              placeholder="Password"
              placeholderTextColor={colors.gray400}
              value={password}
              onChangeText={onChange(setPassword)}
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>Confirm Password</Text>
            <TextInput
              accessibilityLabel="Confirm Password"
              placeholder="Confirm Password"
              placeholderTextColor={colors.gray400}
              value={confirmPassword}
              onChangeText={onChange(setConfirmPassword)}
              secureTextEntry
              style={styles.input}
            />
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
          </View>

          <GradientButton
            title="Create Account"
            loading={isLoading}
            onPress={() => signUp({ firstName, lastName, email, password, confirmPassword })}
            style={styles.cta}
          />

          <View style={{ flex: 1 }} />

          <Pressable style={styles.signinLink} onPress={() => router.back()}>
            <Text style={styles.mutedText}>Already have an account? </Text>
            <Text style={styles.accentText}>Sign In</Text>
          </Pressable>
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
    nameRow: { flexDirection: 'row', gap: 14 },
    input: {
      minWidth: 0,
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
    signinLink: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 24,
    },
    mutedText: { color: colors.textLight, fontSize: 14 },
    accentText: { color: colors.accentInk, fontSize: 14, fontWeight: '600' },
  });
