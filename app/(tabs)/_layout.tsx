import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { radius } from '../../src/theme/theme';
import { useTheme } from '../../src/theme/ThemeContext';
import { useCartStore } from '../../src/store/cartStore';

export default function TabsLayout() {
  const { colors } = useTheme();
  const itemCount = useCartStore((s) => s.itemCount());

  return (
    <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accentInk,
          tabBarActiveBackgroundColor: colors.accentSoft,
          tabBarInactiveTintColor: colors.gray400,
          tabBarStyle: {
            backgroundColor: colors.white,
            width: '100%',
            maxWidth: 720,
            alignSelf: 'center',
            borderTopColor: colors.gray200,
            paddingTop: 4,
            minHeight: 64,
            elevation: 0,
          },
          tabBarItemStyle: { borderRadius: radius.md, marginHorizontal: 12 },
          tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="cart"
          options={{
            title: 'Cart',
            tabBarBadge: itemCount > 0 ? itemCount : undefined,
            tabBarBadgeStyle: { backgroundColor: colors.orange, color: colors.onBrand },
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="bag-handle-outline" color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="options-outline" color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
