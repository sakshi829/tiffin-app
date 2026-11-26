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
      <Tabs.Screen name="index" options={{ title: tr('Today'), headerTitle: tr("Amruta's Kitchen"), tabBarIcon: icon(ICONS.home) }} />
      <Tabs.Screen name="plan" options={{ title: tr('My meals'), tabBarIcon: icon(ICONS.meals) }} />
      <Tabs.Screen name="money" options={{ title: tr('Bills'), tabBarIcon: icon(ICONS.bill) }} />
      <Tabs.Screen name="alerts" options={{ title: tr('Alerts'), tabBarBadge: unread.data ? unread.data : undefined, tabBarIcon: icon(ICONS.bell) }} />
      <Tabs.Screen name="profile" options={{ title: tr('Me'), tabBarIcon: icon(ICONS.person) }} />
    </Tabs>
  );
}
