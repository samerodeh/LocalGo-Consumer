import { useState } from 'react';
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
import { colors, radius } from '../../src/theme/theme';
import { DisplayText } from '../../src/components/DisplayText';
import { GradientButton } from '../../src/components/GradientButton';
import { useAuthStore } from '../../src/store/authStore';

export default function SignUpScreen() {
  const router = useRouter();
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
              <TextInput
                placeholder="First Name"
                placeholderTextColor={colors.gray400}
                value={firstName}
                onChangeText={onChange(setFirstName)}
                autoComplete="name-given"
                style={[styles.input, { flex: 1 }]}
              />
              <TextInput
                placeholder="Last Name"
                placeholderTextColor={colors.gray400}
                value={lastName}
                onChangeText={onChange(setLastName)}
                autoComplete="name-family"
                style={[styles.input, { flex: 1 }]}
              />
            </View>
            <TextInput
              placeholder="Email"
              placeholderTextColor={colors.gray400}
              value={email}
              onChangeText={onChange(setEmail)}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor={colors.gray400}
              value={password}
              onChangeText={onChange(setPassword)}
              secureTextEntry
              style={styles.input}
            />
            <TextInput
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
            onPress={async () => {
              const created = await signUp({ firstName, lastName, email, password, confirmPassword });
              if (created) router.replace('/(auth)/login');
            }}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  topBar: { paddingHorizontal: 16, paddingTop: 4 },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
  header: { paddingTop: 8, paddingBottom: 32 },
  subtitle: { color: colors.textLight, fontSize: 14, marginTop: 4 },
  fields: { gap: 14 },
  nameRow: { flexDirection: 'row', gap: 14 },
  input: {
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    padding: 16,
    fontSize: 16,
    color: colors.navy,
  },
  error: { color: colors.danger, fontSize: 13 },
  cta: { marginTop: 20 },
  signinLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 24,
  },
  mutedText: { color: colors.textLight, fontSize: 14 },
  accentText: { color: colors.orange, fontSize: 14, fontWeight: '600' },
});
