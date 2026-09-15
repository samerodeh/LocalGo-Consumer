import { useEffect } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import { useAuthStore } from '../src/store/authStore';
import { useOrdersStore } from '../src/store/ordersStore';
import { useAddressStore } from '../src/store/addressStore';
import { usePaymentStore } from '../src/store/paymentStore';
// Goer chatbot disabled for now.
// import { useGoerStore } from '../src/goer/goerStore';
import { parseAuthLink } from '../src/lib/authDeepLink';
import { onNotificationTapped, registerForPushNotifications } from '../src/lib/notifications';
import { ORDER_PROGRESS_KINDS, type NotifyKind } from '../src/lib/notifyPush';
import { warmImageCache } from '../src/lib/imagePrefetch';

function RootNavigator() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const bootstrapped = useAuthStore((s) => s.bootstrapped);
  const currentEmail = useAuthStore((s) => s.currentUser?.email ?? null);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const beginPasswordRecovery = useAuthStore((s) => s.beginPasswordRecovery);
  const configureOrders = useOrdersStore((s) => s.configure);
  const syncDeliveryStatus = useOrdersStore((s) => s.syncDeliveryStatus);
  const configureAddresses = useAddressStore((s) => s.configure);
  const configureCards = usePaymentStore((s) => s.configure);
  // const configureGoer = useGoerStore((s) => s.configure);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Re-scope per-user stores whenever the signed-in account changes.
  useEffect(() => {
    configureOrders(currentEmail);
    configureAddresses(currentEmail);
    configureCards(currentEmail);
    // configureGoer(currentEmail);
  }, [currentEmail, configureOrders, configureAddresses, configureCards]);

  // Register this device for push (new-order-accepted / chat-message alerts)
  // once signed in; re-runs harmlessly if the account changes.
  useEffect(() => {
    if (isLoggedIn) void registerForPushNotifications();
  }, [isLoggedIn, currentEmail]);

  // Warm the image cache (restaurant heroes + first screenful of menu photos)
  // once signed in, so browsing feels instant. One-shot per app session.
  useEffect(() => {
    if (isLoggedIn) warmImageCache();
  }, [isLoggedIn]);

  // Tapping a push opens what it was about: a delivery update opens that
  // order, a chat message opens that thread. Before the progress kinds were
  // named, every order push landed in the chat screen.
  useEffect(() => {
    return onNotificationTapped((data) => {
      const orderId = typeof data.orderId === 'string' ? data.orderId : null;
      if (!orderId) return;
      const kind = data.kind as NotifyKind | undefined;
      if (kind && ORDER_PROGRESS_KINDS.includes(kind)) {
        // Refresh first: the push is the notice that something changed, and the
        // screen it opens should already show it.
        void syncDeliveryStatus();
        router.push({ pathname: '/order/[id]', params: { id: orderId } });
        return;
      }
      router.push({ pathname: '/chat', params: { orderId } });
    });
  }, [router, syncDeliveryStatus]);

  // Catches the deep link a password-reset email opens (localgo://reset-password#access_token=...),
  // exchanges the tokens for a live session, then routes to the set-new-password screen.
  useEffect(() => {
    async function handleUrl(url: string | null) {
      if (!url) return;
      const { accessToken, refreshToken, type } = parseAuthLink(url);
      if (type === 'recovery' && accessToken && refreshToken) {
        const ok = await beginPasswordRecovery(accessToken, refreshToken);
        if (ok) router.push('/reset-password');
      }
    }
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => sub.remove();
  }, [beginPasswordRecovery, router]);

  if (!bootstrapped) {
    return <View style={{ flex: 1, backgroundColor: colors.offWhite }} />;
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.offWhite } }}>
        <Stack.Protected guard={isLoggedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="restaurant/[id]"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="address" options={{ presentation: 'modal' }} />
          <Stack.Screen name="payment" options={{ presentation: 'modal' }} />
          <Stack.Screen name="chat" options={{ presentation: 'modal' }} />
          <Stack.Screen name="order/[id]" options={{ animation: 'slide_from_right' }} />
          <Stack.Screen
            name="order-confirmed"
            options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
          />
        </Stack.Protected>
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Reachable whether signed in or not — the password-reset deep link can
            land here either way (e.g. reset requested while already logged in). */}
        <Stack.Screen name="reset-password" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    'BarlowCondensed-Black': require('../assets/fonts/BarlowCondensed-Black.ttf'),
    'BarlowCondensed-ExtraBold': require('../assets/fonts/BarlowCondensed-ExtraBold.ttf'),
    'BarlowCondensed-Bold': require('../assets/fonts/BarlowCondensed-Bold.ttf'),
    'BarlowCondensed-SemiBold': require('../assets/fonts/BarlowCondensed-SemiBold.ttf'),
  });

  if (!fontsLoaded) {
    return <View style={{ flex: 1 }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <SafeAreaProvider>
          <RootNavigator />
        </SafeAreaProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
