import { Tabs } from 'expo-router/js-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, ICONS, useColors, useT, useTabBarLayout, useUnreadCount, type IconName } from '@amruta/app-core';

export default function TabsLayout() {
  const c = useColors();
  const tr = useT();
  const unread = useUnreadCount();
  const tabBar = useTabBarLayout(12, 5);
  const insets = useSafeAreaInsets();
  const tabIcon = (name: IconName) => ({ focused }: { focused: boolean }) => <Icon name={name} size={24} color={focused ? c.primary : c.muted} />;
  return (
    <Tabs screenOptions={{
      ...tabBar,
      // Icon (24) + label (16) + gaps: 66 px; the phone's bottom safe area (iPhone home bar) is added on top.
      tabBarStyle: [tabBar.tabBarStyle, { backgroundColor: c.card, borderTopColor: c.border, height: 66 + insets.bottom, paddingTop: 4, paddingBottom: Math.max(insets.bottom, 8) }],
      tabBarLabelStyle: [tabBar.tabBarLabelStyle, { lineHeight: 16 }],
      headerTitleAlign: 'center', tabBarActiveTintColor: c.primary, tabBarInactiveTintColor: c.muted,
      headerStyle: { backgroundColor: c.bg }, headerShadowVisible: false,
    }}>
      <Tabs.Screen name="index" options={{ title: tr('Today'), headerTitle: tr("Amruta's Kitchen"), tabBarIcon: tabIcon(ICONS.home) }} />
      <Tabs.Screen name="plan" options={{ title: tr('My meals'), tabBarIcon: tabIcon(ICONS.meals) }} />
      <Tabs.Screen name="money" options={{ title: tr('Bills'), tabBarIcon: tabIcon(ICONS.bill) }} />
      <Tabs.Screen name="alerts" options={{ title: tr('Alerts'), tabBarBadge: unread.data ? unread.data : undefined, tabBarIcon: tabIcon(ICONS.bell) }} />
      <Tabs.Screen name="profile" options={{ title: tr('Me'), tabBarIcon: tabIcon(ICONS.person) }} />
    </Tabs>
  );
}
