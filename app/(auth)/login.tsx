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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accentGradient, colors, radius } from '../../src/theme/theme';
import { DisplayText } from '../../src/components/DisplayText';
import { GradientButton } from '../../src/components/GradientButton';
import { useAuthStore } from '../../src/store/authStore';
import { isSupabaseConfigured } from '../../src/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, errorMessage, clearError, signUpNotice, clearSignUpNotice } = useAuthStore();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
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
            <LinearGradient
              colors={accentGradient as unknown as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.logoCircle}
            >
              <Ionicons name="bag" size={32} color={colors.white} />
            </LinearGradient>
            <DisplayText size={40} weight="heavy" style={{ marginTop: 10 }}>
              <Text style={{ color: colors.navy }}>Local</Text>
              <Text style={{ color: colors.orange }}>GO</Text>
            </DisplayText>
            <Text style={styles.tagline}>Groceries delivered fast.</Text>
            {!isSupabaseConfigured && (
              <View style={styles.demoPill}>
                <Text style={styles.demoPillText}>Demo mode · sample data</Text>
              </View>
            )}
          </View>

          <View style={styles.fields}>
            {signUpNotice ? <Text style={styles.notice}>{signUpNotice}</Text> : null}
            <TextInput
              placeholder="Email"
              placeholderTextColor={colors.gray400}
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                if (errorMessage) clearError();
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              style={styles.input}
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor={colors.gray400}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                if (errorMessage) clearError();
              }}
              secureTextEntry
              style={styles.input}
            />
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            <Pressable
              style={styles.forgotLink}
              onPress={() => router.push('/(auth)/forgot-password')}
            >
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </View>

          <GradientButton
            title="Sign In"
            loading={isLoading}
            onPress={() => {
              clearSignUpNotice();
              login(email, password);
            }}
            style={styles.cta}
          />

          <View style={{ flex: 1 }} />

          <Pressable style={styles.signupLink} onPress={() => router.push('/(auth)/signup')}>
            <Text style={styles.signupMuted}>Don't have an account? </Text>
            <Text style={styles.signupAccent}>Sign Up</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.white },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 32 },
  header: { alignItems: 'center', paddingTop: 40, paddingBottom: 40 },
  logoCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.orange,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  tagline: { color: colors.textLight, fontSize: 14, marginTop: 4 },
  demoPill: {
    marginTop: 14,
    backgroundColor: 'rgba(249,115,22,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
  },
  demoPillText: { color: colors.orangeDark, fontSize: 12, fontWeight: '600' },
  fields: { gap: 14 },
  input: {
    backgroundColor: colors.gray100,
    borderRadius: radius.md,
    padding: 16,
    fontSize: 16,
    color: colors.navy,
  },
  error: { color: colors.danger, fontSize: 13 },
  notice: { color: '#15803d', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  forgotLink: { alignSelf: 'flex-end' },
  forgotText: { color: colors.orange, fontSize: 13, fontWeight: '600' },
  cta: { marginTop: 20 },
  signupLink: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 24,
  },
  signupMuted: { color: colors.textLight, fontSize: 14 },
  signupAccent: { color: colors.orange, fontSize: 14, fontWeight: '600' },
});
