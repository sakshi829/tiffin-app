import { Tabs } from 'expo-router/js-tabs';
import { useUnreadCount, useT } from '@amruta/app-core';
import { useColors } from '../../../ui/theme';

export default function TabsLayout() {
  const tr = useT();
  const c = useColors();
  const unread = useUnreadCount();
  return (
    <Tabs
      screenOptions={{
        headerTitleAlign: 'center',
        tabBarActiveTintColor: c.primary,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
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
