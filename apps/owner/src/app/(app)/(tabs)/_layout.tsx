import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ICONS, useIconTabBarOptions, useT, useTabIcon, useUnreadCount } from '@amruta/app-core';

export default function TabsLayout() {
  const tr = useT();
  const unread = useUnreadCount();
  const options = useIconTabBarOptions(5, useSafeAreaInsets().bottom);
  const icon = useTabIcon();
  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen name="index" options={{ title: tr('Today'), tabBarIcon: icon(ICONS.home) }} />
      <Tabs.Screen name="customers" options={{ title: tr('Customers'), tabBarIcon: icon(ICONS.people) }} />
      <Tabs.Screen name="menu" options={{ title: tr('Menu'), tabBarIcon: icon(ICONS.meals) }} />
      <Tabs.Screen name="money" options={{ title: tr('Money'), tabBarIcon: icon(ICONS.money) }} />
      <Tabs.Screen name="more" options={{ title: tr('More'), tabBarBadge: unread.data ? unread.data : undefined, tabBarIcon: icon(ICONS.more) }} />
    </Tabs>
  );
}
