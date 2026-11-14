import { useMemo, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radius } from '../../src/theme/theme';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { useAuthStore } from '../../src/store/authStore';
import { PRIVACY_URL } from '../../src/lib/support';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const [signOutVisible, setSignOutVisible] = useState(false);

  const fullName = user ? `${user.firstName} ${user.lastName}` : 'Guest';
  const initials = user ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase() : '?';
  const version = Constants.expoConfig?.version ?? '1.0';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.titleBar}>
        <DisplayText size={34} weight="bold" color={colors.navy}>
          Settings
        </DisplayText>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 28 }}>
        {/* Profile */}
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{fullName}</Text>
              <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
            </View>
          </View>
        </View>

        {/* Account */}
        <Section title="Account" styles={styles}>
          <SettingsRow
            icon="trash-outline"
            label="Delete Account"
            onPress={() => router.push('/delete-account')}
            styles={styles}
            colors={colors}
          />
          <SettingsRow
            icon="notifications-outline"
            label="Notifications"
            styles={styles}
            colors={colors}
          />
          <SettingsRow
            icon="card-outline"
            label="Payment Methods"
            onPress={() => router.push('/payment')}
            styles={styles}
            colors={colors}
          />
          <SettingsRow
            icon="location-outline"
            label="Delivery Addresses"
            onPress={() => router.push('/address')}
            styles={styles}
            colors={colors}
          />
        </Section>

        {/* Preferences */}
        <Section title="Preferences" styles={styles}>
          <View style={styles.settingsRow}>
            <View style={styles.rowLeft}>
              <Ionicons name={isDark ? 'moon' : 'moon-outline'} size={20} color={colors.navy} />
              <Text style={styles.rowLabel}>Dark Mode</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggle}
              trackColor={{ false: colors.gray300, true: colors.orange }}
              thumbColor={colors.white}
            />
          </View>
        </Section>

        {/* About */}
        <Section title="About" styles={styles}>
          <SettingsRow
            icon="shield-checkmark-outline"
            label="Privacy Policy"
            onPress={() => {
              void Linking.openURL(PRIVACY_URL).catch(() =>
                Alert.alert('Privacy Policy', `Read the policy at ${PRIVACY_URL}`),
              );
            }}
            styles={styles}
            colors={colors}
          />
          <View style={styles.settingsRow}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>{version}</Text>
          </View>
        </Section>

        <Pressable style={styles.signOut} onPress={() => setSignOutVisible(true)}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>

      <ConfirmModal
        visible={signOutVisible}
        title="Sign out?"
        message="You'll need to sign back in to place orders."
        confirmLabel="Sign Out"
        destructive
        onCancel={() => setSignOutVisible(false)}
        onConfirm={() => {
          setSignOutVisible(false);
          void logout();
        }}
      />
    </SafeAreaView>
  );
}

function Section({
  title,
  children,
  styles,
}: {
  title: string;
  children: React.ReactNode;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function SettingsRow({
  icon,
  label,
  onPress,
  styles,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemePalette;
}) {
  return (
    <Pressable style={styles.settingsRow} onPress={onPress} disabled={!onPress}>
      <View style={styles.rowLeft}>
        <Ionicons name={icon} size={20} color={colors.navy} />
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.gray300} /> : null}
    </Pressable>
  );
}

const makeStyles = (colors: ThemePalette) =>
  StyleSheet.create({
    safe: {
      flex: 1,
      width: '100%',
      maxWidth: 720,
      alignSelf: 'center',
      backgroundColor: colors.offWhite,
    },
    titleBar: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 },
    card: {
      backgroundColor: colors.white,
      borderRadius: radius.lg,
      paddingHorizontal: 18,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.gray200,
    },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 24 },
    avatar: {
      width: 64,
      height: 64,
      borderRadius: radius.lg,
      backgroundColor: colors.brandNavy,
      alignItems: 'center',
      justifyContent: 'center',
    },
    initials: { fontSize: 22, fontWeight: '700', color: colors.onBrand },
    profileName: { fontSize: 20, fontWeight: '700', color: colors.navy },
    profileEmail: {
      fontSize: 13,
      lineHeight: 20,
      color: colors.textLight,
      marginTop: 4,
      flexShrink: 1,
    },
    sectionTitle: {
      fontSize: 10,
      fontWeight: '800',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      paddingHorizontal: 4,
      marginBottom: 4,
    },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 60,
      paddingVertical: 18,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.gray100,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowLabel: { fontSize: 15, color: colors.navy },
    rowValue: { fontSize: 15, color: colors.textLight },
    signOut: {
      backgroundColor: colors.white,
      borderRadius: radius.md,
      paddingVertical: 18,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.gray200,
    },
    signOutText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
  });
