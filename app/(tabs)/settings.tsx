import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme, type ThemePalette } from '../../src/theme/ThemeContext';
import { DisplayText } from '../../src/components/DisplayText';
import { ConfirmModal } from '../../src/components/ConfirmModal';
import { useAuthStore } from '../../src/store/authStore';
import { deleteAccount } from '../../src/lib/account';

export default function SettingsScreen() {
  const router = useRouter();
  const { colors, isDark, toggle } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const user = useAuthStore((s) => s.currentUser);
  const logout = useAuthStore((s) => s.logout);
  const [signOutVisible, setSignOutVisible] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Required by Google Play for any app offering sign-up. Orders survive as
  // anonymized records; everything identifying the customer is removed. See
  // src/lib/account.ts.
  const confirmDelete = async () => {
    setDeleteVisible(false);
    setDeleting(true);
    const result = await deleteAccount(user?.email ?? null);
    setDeleting(false);

    if (!result.ok) {
      Alert.alert('Could not delete account', result.error);
      return;
    }
    // Signing out last: the auth gate swaps to the login screen, unmounting
    // this component, so nothing after this runs.
    await logout();
  };

  const fullName = user ? `${user.firstName} ${user.lastName}` : 'Guest';
  const initials = user
    ? `${user.firstName[0] ?? ''}${user.lastName[0] ?? ''}`.toUpperCase()
    : '?';
  const version = Constants.expoConfig?.version ?? '1.0';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.titleBar}>
        <DisplayText size={26} weight="bold" color={colors.navy}>
          Settings
        </DisplayText>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 24 }}>
        {/* Profile */}
        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
            <View>
              <Text style={styles.profileName}>{fullName}</Text>
              <Text style={styles.profileEmail}>{user?.email ?? ''}</Text>
            </View>
          </View>
        </View>

        {/* Account */}
        <Section title="Account" styles={styles}>
          <SettingsRow
            icon="receipt-outline"
            label="Your Orders"
            onPress={() => router.push('/(tabs)/orders')}
            styles={styles}
            colors={colors}
          />
          <SettingsRow icon="notifications-outline" label="Notifications" styles={styles} colors={colors} />
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
          <View style={styles.settingsRow}>
            <Text style={styles.rowLabel}>Version</Text>
            <Text style={styles.rowValue}>{version}</Text>
          </View>
        </Section>

        <Pressable style={styles.signOut} onPress={() => setSignOutVisible(true)}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </Pressable>

        <Pressable
          style={styles.deleteAccount}
          onPress={() => setDeleteVisible(true)}
          disabled={deleting}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Text style={styles.deleteAccountText}>Delete Account</Text>
          )}
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

      <ConfirmModal
        visible={deleteVisible}
        title="Delete your account?"
        message={
          'This permanently deletes your account, saved addresses, and payment cards. ' +
          'Past orders are kept as business records but no longer linked to you. ' +
          "This can't be undone."
        }
        confirmLabel="Delete Account"
        destructive
        onCancel={() => setDeleteVisible(false)}
        onConfirm={() => void confirmDelete()}
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
    safe: { flex: 1, backgroundColor: colors.offWhite },
    titleBar: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
    card: {
      backgroundColor: colors.white,
      borderRadius: 14,
      paddingHorizontal: 16,
      overflow: 'hidden',
    },
    profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16 },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: 'rgba(249,115,22,0.15)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    initials: { fontSize: 18, fontWeight: '700', color: colors.orange },
    profileName: { fontSize: 15, fontWeight: '700', color: colors.navy },
    profileEmail: { fontSize: 12, color: colors.textLight, marginTop: 2 },
    sectionTitle: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textLight,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      paddingHorizontal: 4,
    },
    settingsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.gray200,
    },
    rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowLabel: { fontSize: 15, color: colors.navy },
    rowValue: { fontSize: 15, color: colors.textLight },
    signOut: {
      backgroundColor: colors.white,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    signOutText: { color: colors.danger, fontSize: 15, fontWeight: '600' },
    deleteAccount: { paddingVertical: 18, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
    deleteAccountText: {
      color: colors.danger,
      fontSize: 14,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
  });
