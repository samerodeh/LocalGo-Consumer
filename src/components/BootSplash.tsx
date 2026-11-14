/**
 * What the app shows while auth bootstraps.
 *
 * This replaced a bare `<View style={{flex:1}} />`, which was indistinguishable
 * from a crashed app — and on an unreachable backend it was on screen for as
 * long as the session refresh took to give up. A logo and a spinner make the
 * same wait read as "starting", and the delayed line below tells the truth when
 * the wait gets long instead of leaving the user guessing.
 *
 * Two constraints shape this component:
 *  - It does NOT use the Barlow Condensed families. It can render before
 *    expo-font resolves (and still renders if it fails), so the wordmark uses
 *    the system face rather than adding a second blank-screen dependency.
 *  - It does NOT use `useTheme()`. One of its two mount points (the font gate)
 *    sits outside ThemeProvider, so it reads the OS colour scheme directly and
 *    works in either position.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { accentGradient, colors } from '../theme/theme';

/** How long the wait has to run before we admit it is taking a while. */
const SLOW_NOTICE_MS = 6000;

/** Mirrors ThemeContext's dark `offWhite` surface so there is no flash when the
 *  real themed UI mounts behind it. */
const DARK_SURFACE = '#0B1220';

export default function BootSplash() {
  const [slow, setSlow] = useState(false);
  const isDark = useColorScheme() === 'dark';

  useEffect(() => {
    const t = setTimeout(() => setSlow(true), SLOW_NOTICE_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: isDark ? DARK_SURFACE : colors.offWhite }]}>
      <LinearGradient
        colors={accentGradient as unknown as [string, string]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.logoCircle}
      >
        <Ionicons name="bag" size={32} color={colors.white} />
      </LinearGradient>

      <Text style={styles.wordmark}>
        <Text style={{ color: isDark ? colors.white : colors.navy }}>Local</Text>
        <Text style={{ color: colors.orange }}>GO</Text>
      </Text>

      <ActivityIndicator color={colors.orange} style={styles.spinner} />

      {/* Reserved height so the line appearing doesn't shift the logo. */}
      <View style={styles.noticeSlot}>
        {slow && <Text style={styles.notice}>Still connecting…</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoCircle: {
    width: 74,
    height: 74,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.orangeDark,
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  wordmark: {
    marginTop: 14,
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  spinner: { marginTop: 28 },
  noticeSlot: { height: 22, marginTop: 14, justifyContent: 'center' },
  notice: { color: colors.textLight, fontSize: 13, textAlign: 'center' },
});
