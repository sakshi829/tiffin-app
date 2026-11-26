import { Tabs } from 'expo-router/js-tabs';
import { useTabBarLayout, useUnreadCount, useT } from '@amruta/app-core';
import { useColors } from '../../../ui/theme';

export default function TabsLayout() {
  const tr = useT();
  const c = useColors();
  const unread = useUnreadCount();
  const tabBar = useTabBarLayout(13);
  return (
    <Tabs
      screenOptions={{
        ...tabBar,
        headerTitleAlign: 'center',
        tabBarActiveTintColor: c.primary,
        tabBarIconStyle: { display: 'none' },
      }}>
      <Tabs.Screen name="index" options={{ title: tr('Today') }} />
      <Tabs.Screen name="customers" options={{ title: tr('Customers') }} />
      <Tabs.Screen name="menu" options={{ title: tr('Menu') }} />
      <Tabs.Screen name="money" options={{ title: tr('Money') }} />
      <Tabs.Screen name="more" options={{ title: tr('More'), tabBarBadge: unread.data ? unread.data : undefined }} />
    </Tabs>
  );
}
