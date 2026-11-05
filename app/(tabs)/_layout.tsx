import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/theme/ThemeContext';
import { useCartStore } from '../../src/store/cartStore';
import { useOrdersStore } from '../../src/store/ordersStore';
import { isInFlight } from '../../src/lib/orderFormat';
import { GoerSheet } from '../../src/components/goer/GoerSheet';
import { GoerFab } from '../../src/components/goer/GoerFab';
import { authenticatedGoerEnabled } from '../../src/goer/authenticatedClient';

export default function TabsLayout() {
  const { colors } = useTheme();
  const itemCount = useCartStore((s) => s.itemCount());
  // Badges the Orders tab while something is still on its way, so a customer
  // waiting on a delivery has one obvious place to look.
  const activeOrders = useOrdersStore((s) => s.orders.filter(isInFlight).length);

  return (
    <View style={{ flex: 1 }}>
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.orange,
        tabBarInactiveTintColor: colors.gray400,
        tabBarStyle: {
          backgroundColor: colors.white,
          borderTopColor: colors.gray200,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: 'Orders',
          tabBarBadge: activeOrders > 0 ? activeOrders : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.orange },
          tabBarIcon: ({ color, size }) => <Ionicons name="receipt" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          title: 'Cart',
          tabBarBadge: itemCount > 0 ? itemCount : undefined,
          tabBarBadgeStyle: { backgroundColor: colors.orange },
          tabBarIcon: ({ color, size }) => <Ionicons name="cart" color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings" color={color} size={size} />,
        }}
      />
    </Tabs>
    {/* Single chat surface for the whole tab group — per-screen Modals would
        double-present since both tab screens stay mounted. */}
    {authenticatedGoerEnabled && <><GoerFab /><GoerSheet /></>}
    </View>
  );
}
