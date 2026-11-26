import { Tabs } from 'expo-router/js-tabs';
import { useColors, useT, useUnreadCount } from '@amruta/app-core';

export default function TabsLayout() {
  const c = useColors();
  const tr = useT();
  const unread = useUnreadCount();
  return (
    <Tabs screenOptions={{
      headerTitleAlign: 'center', tabBarActiveTintColor: c.primary,
      tabBarLabelStyle: { fontSize: 14, fontWeight: '600' }, tabBarIconStyle: { display: 'none' },
    }}>
      <Tabs.Screen name="index" options={{ title: tr('Today'), headerTitle: tr("Amruta's Kitchen") }} />
      <Tabs.Screen name="plan" options={{ title: tr('My meals') }} />
      <Tabs.Screen name="money" options={{ title: tr('Bills') }} />
      <Tabs.Screen name="alerts" options={{ title: tr('Alerts'), tabBarBadge: unread.data ? unread.data : undefined }} />
      <Tabs.Screen name="profile" options={{ title: tr('Me') }} />
    </Tabs>
  );
}
