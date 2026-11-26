import { Tabs } from 'expo-router/js-tabs';
import { useColors, useUnreadCount, useT } from '@amruta/app-core';
import { isDeliveryRole, useStaffMe } from '../../../lib/auth';

/** Tabs depend on the role the owner gave: kitchen staff never see the Boxes tab. */
export default function TabsLayout() {
  const tr = useT();
  const c = useColors();
  const { staff } = useStaffMe();
  const unread = useUnreadCount();
  return (
    <Tabs screenOptions={{
      headerTitleAlign: 'center', tabBarActiveTintColor: c.primary,
      tabBarLabelStyle: { fontSize: 14, fontWeight: '600' }, tabBarIconStyle: { display: 'none' },
    }}>
      <Tabs.Screen name="index" options={{ title: tr('Work'), headerTitle: tr('Today\'s work') }} />
      <Tabs.Screen name="boxes" options={{ title: tr('Boxes'), href: isDeliveryRole(staff) ? undefined : null }} />
      <Tabs.Screen name="alerts" options={{ title: tr('Alerts'), tabBarBadge: unread.data ? unread.data : undefined }} />
      <Tabs.Screen name="me" options={{ title: tr('Me') }} />
    </Tabs>
  );
}
