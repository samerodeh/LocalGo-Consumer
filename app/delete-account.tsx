import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DisplayText } from '../src/components/DisplayText';
import { radius } from '../src/theme/theme';
import { useTheme } from '../src/theme/ThemeContext';
import { useAuthStore } from '../src/store/authStore';
import { deletionRequestUrl, SUPPORT_EMAIL, DELETION_URL } from '../src/lib/support';

export default function DeleteAccountScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const email = useAuthStore((state) => state.currentUser?.email);
  const [mailUnavailable, setMailUnavailable] = useState(false);

  async function composeRequest() {
    setMailUnavailable(false);
    try {
      // Opening the composer does not send the request or delete an account.
      await Linking.openURL(deletionRequestUrl(email));
    } catch {
      setMailUnavailable(true);
    }
  }

  const paragraph = { color: colors.navy, fontSize: 16, lineHeight: 24 };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.offWhite }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/login'))}
        >
          <Text style={{ color: colors.orange, fontSize: 16 }}>Back</Text>
        </Pressable>
        <DisplayText accessibilityRole="header" size={36} color={colors.navy}>
          Delete your LocalGo account
        </DisplayText>
        <Text style={paragraph}>
          Request deletion of your consumer account and associated personal data by emailing LocalGo
          support from your registered email address. Do not include your password.
        </Text>
        <View
          style={{
            gap: 10,
            padding: 20,
            backgroundColor: colors.white,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.gray200,
          }}
        >
          <Text selectable style={paragraph}>
            To: {SUPPORT_EMAIL}
          </Text>
          <Text selectable style={paragraph}>
            Subject: Delete my LocalGo account
          </Text>
          {email ? (
            <Text selectable style={paragraph}>
              Account: {email}
            </Text>
          ) : null}
        </View>
        <Text style={paragraph}>
          We will verify that you own the account before processing your request. This includes
          removing account and profile information and associated personal data that is no longer
          needed. If records must be retained for a legal obligation or an unresolved issue, we will
          explain the reason and applicable period in our response. Backup copies may remain until
          their retention period expires.
        </Text>
        <Text style={paragraph}>
          Opening the email below does not send a request. Send it from your email app to submit it.
          You can also email support from another device. Uninstalling LocalGo does not delete your
          account; you can clear data stored on your phone through its app settings.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={composeRequest}
          style={{ padding: 18, borderRadius: radius.md, backgroundColor: colors.orange }}
        >
          <Text
            style={{ color: colors.onBrand, fontSize: 16, fontWeight: '700', textAlign: 'center' }}
          >
            Compose deletion request
          </Text>
        </Pressable>
        {mailUnavailable ? (
          <Text accessibilityRole="alert" style={{ ...paragraph, color: colors.danger }}>
            No email app could be opened. Use your email service to send the request to{' '}
            {SUPPORT_EMAIL} with the subject above.
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(DELETION_URL).catch(() =>
              Alert.alert('Account deletion', `Visit ${DELETION_URL}`),
            );
          }}
        >
          <Text style={{ color: colors.orange, fontSize: 16 }}>View account-deletion webpage</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
