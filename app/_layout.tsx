import { useEffect } from 'react';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Linking from 'expo-linking';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StripeProvider } from '../src/lib/stripeProvider';
import { useFonts } from 'expo-font';
import { ThemeProvider, useTheme } from '../src/theme/ThemeContext';
import BootSplash from '../src/components/BootSplash';
import { useAuthStore } from '../src/store/authStore';
import { useOrdersStore } from '../src/store/ordersStore';
import { useAddressStore } from '../src/store/addressStore';
import { usePaymentStore } from '../src/store/paymentStore';
import { parseAuthLink } from '../src/lib/authDeepLink';
import {
  ensureNotificationPermission,
  onNotificationTapped,
  registerForPushNotifications,
} from '../src/lib/notifications';
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
  const configureAddresses = useAddressStore((s) => s.configure);
  const configureCards = usePaymentStore((s) => s.configure);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Re-scope per-user stores whenever the signed-in account changes.
  useEffect(() => {
    configureOrders(currentEmail);
    configureAddresses(currentEmail);
    configureCards(currentEmail);
  }, [currentEmail, configureOrders, configureAddresses, configureCards]);

  // Ask for notification permission up front so in-app LOCAL alerts (order
  // status changes, the "finding a driver" timer) can fire with sound even in
  // Expo Go / simulators, independent of remote push. One-shot, memoized.
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);

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

  // Message alerts open chat; fulfillment alerts open the order tracker.
  useEffect(() => {
    return onNotificationTapped((data) => {
      if (typeof data.orderId === 'string') {
        if (data.kind === 'new_message' || !data.kind) {
          router.push({ pathname: '/chat', params: { orderId: data.orderId } });
        } else {
          router.push({ pathname: '/(tabs)', params: { trackOrderId: data.orderId } });
        }
      }
    });
  }, [router]);

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
    return <BootSplash />;
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.offWhite } }}
      >
        <Stack.Protected guard={isLoggedIn}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="restaurant/[id]"
            options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
          />
          <Stack.Screen name="address" options={{ presentation: 'modal' }} />
          <Stack.Screen name="payment" options={{ presentation: 'modal' }} />
          <Stack.Screen name="chat" options={{ presentation: 'modal' }} />
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
        <Stack.Screen name="delete-account" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // The error half must not be dropped: useFonts leaves `loaded` false forever
  // when a face fails, so gating on `loaded` alone turns any font problem into a
  // permanent blank screen. Shipping with the system font beats shipping nothing.
  const [fontsLoaded, fontError] = useFonts({
    'BarlowCondensed-Black': require('../assets/fonts/BarlowCondensed-Black.ttf'),
    'BarlowCondensed-ExtraBold': require('../assets/fonts/BarlowCondensed-ExtraBold.ttf'),
    'BarlowCondensed-Bold': require('../assets/fonts/BarlowCondensed-Bold.ttf'),
    'BarlowCondensed-SemiBold': require('../assets/fonts/BarlowCondensed-SemiBold.ttf'),
  });

  if (!fontsLoaded && !fontError) {
    return <BootSplash />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}>
        <ThemeProvider>
          <SafeAreaProvider>
            <RootNavigator />
          </SafeAreaProvider>
        </ThemeProvider>
      </StripeProvider>
    </GestureHandlerRootView>
  );
}
