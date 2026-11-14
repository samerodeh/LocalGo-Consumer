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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accentGradient, radius } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { GradientButton } from '../../src/components/GradientButton';
import { useAuthStore } from '../../src/store/authStore';
import { isSupabaseConfigured } from '../../src/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, isLoading, errorMessage, clearError } = useAuthStore();

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
              <Ionicons name="bag" size={32} color={colors.onBrand} />
            </LinearGradient>
            <DisplayText size={42} weight="heavy" style={{ marginTop: 12 }}>
              <Text style={{ color: colors.onBrand }}>Local</Text>
              <Text style={{ color: colors.orange }}>GO</Text>
            </DisplayText>
            <Text style={styles.tagline}>Your neighbourhood. Your favourites.</Text>
            {!isSupabaseConfigured && (
              <View style={styles.demoPill}>
                <Text style={styles.demoPillText}>Demo mode · sample data</Text>
              </View>
            )}
          </View>

          <View style={styles.welcome}>
            <Text style={styles.eyebrow}>A TASTE OF LOCAL</Text>
            <DisplayText size={36} weight="heavy">
              Welcome back.
            </DisplayText>
            <Text style={styles.welcomeBody}>Good food is just around the corner.</Text>
          </View>
          <View style={styles.fields}>
            <Text style={styles.fieldLabel}>Email</Text>
            <TextInput
              accessibilityLabel="Email"
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
            <Text style={styles.fieldLabel}>Password</Text>
            <TextInput
              accessibilityLabel="Password"
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
            onPress={() => login(email, password)}
            style={styles.cta}
          />

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.or}>or</Text>
            <View style={styles.divider} />
          </View>

          <View style={styles.social}>
            <SocialButton icon="logo-apple" label="Continue with Apple" dark />
            <SocialButton icon="logo-google" label="Continue with Google" />
          </View>

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

function SocialButton({
  icon,
  label,
  dark,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  dark?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={[styles.socialButton, dark && styles.socialDark]}>
      <Ionicons name={icon} size={20} color={dark ? colors.onBrand : colors.navy} />
      <Text style={[styles.socialLabel, dark && { color: colors.onBrand }]}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    fieldLabel: { fontSize: 12, fontWeight: '700', color: colors.navy, marginBottom: -4 },
    welcome: { marginBottom: 28 },
    eyebrow: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1.8,
      color: colors.accentInk,
      marginBottom: 10,
    },
    welcomeBody: { fontSize: 15, lineHeight: 22, color: colors.textLight, marginTop: 8 },
    safe: {
      flex: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      backgroundColor: colors.offWhite,
    },
    scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 32 },
    header: {
      alignItems: 'center',
      paddingVertical: 30,
      paddingHorizontal: 20,
      marginBottom: 32,
      backgroundColor: colors.brandNavy,
      borderRadius: radius.xl,
    },
    logoCircle: {
      width: 58,
      height: 58,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tagline: { color: colors.onBrandMuted, fontSize: 13, marginTop: 8 },
    demoPill: {
      marginTop: 14,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: 999,
    },
    demoPillText: { color: colors.orangeDark, fontSize: 12, fontWeight: '600' },
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
    forgotLink: { alignSelf: 'flex-end' },
    forgotText: { color: colors.accentInk, fontSize: 13, fontWeight: '600' },
    cta: { marginTop: 24 },
    dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
    divider: { flex: 1, height: 1, backgroundColor: colors.gray200 },
    or: { color: colors.textLight, fontSize: 13, paddingHorizontal: 8 },
    social: { gap: 12 },
    socialButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      height: 54,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.gray200,
      backgroundColor: colors.white,
    },
    socialDark: { backgroundColor: colors.brandNavy, borderColor: colors.brandNavy },
    socialLabel: { fontSize: 15, fontWeight: '600', color: colors.navy },
    signupLink: {
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 24,
    },
    signupMuted: { color: colors.textLight, fontSize: 14 },
    signupAccent: { color: colors.accentInk, fontSize: 14, fontWeight: '600' },
  });
