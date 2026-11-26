import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { LanguageSync, onNotificationTap, registerForPush, setupNotificationHandling, useT } from '@amruta/app-core';
import { OfflineQueueProvider } from '../../lib/offline';

// A screen opened by its web address or after a reload still has the tabs underneath it,
// so its header shows a back arrow (expo-router 58: unstable_settings.anchor).
export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
  const tr = useT();   // the back arrow reads "AK Staff, back", not "(tabs), back"
  useEffect(() => {
    setupNotificationHandling();
    void registerForPush('Staff app');
    return onNotificationTap(() => router.push('/alerts'));
  }, []);
  return (
    <OfflineQueueProvider>
      <LanguageSync />
      <Stack screenOptions={{ headerTitleAlign: 'center', headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: tr("AK Staff") }} />
      </Stack>
    </OfflineQueueProvider>
  );
}
