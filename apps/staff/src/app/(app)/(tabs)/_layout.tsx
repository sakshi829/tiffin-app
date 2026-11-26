import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ICONS, useIconTabBarOptions, useT, useTabIcon, useUnreadCount } from '@amruta/app-core';
import { isDeliveryRole, useStaffMe } from '../../../lib/auth';

/** Tabs depend on the role the owner gave: kitchen staff never see the Boxes tab. */
export default function TabsLayout() {
  const tr = useT();
  const { staff } = useStaffMe();
  const unread = useUnreadCount();
  const options = useIconTabBarOptions(isDeliveryRole(staff) ? 4 : 3, useSafeAreaInsets().bottom);
  const icon = useTabIcon();
  return (
    <Tabs screenOptions={options}>
      <Tabs.Screen name="index" options={{ title: tr('Work'), headerTitle: tr('Today\'s work'), tabBarIcon: icon(ICONS.work) }} />
      <Tabs.Screen name="boxes" options={{ title: tr('Boxes'), href: isDeliveryRole(staff) ? undefined : null, tabBarIcon: icon(ICONS.box) }} />
      <Tabs.Screen name="alerts" options={{ title: tr('Alerts'), tabBarBadge: unread.data ? unread.data : undefined, tabBarIcon: icon(ICONS.bell) }} />
      <Tabs.Screen name="me" options={{ title: tr('Me'), tabBarIcon: icon(ICONS.person) }} />
    </Tabs>
  );
}
