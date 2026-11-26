import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { LanguageSync, onNotificationTap, registerForPush, setupNotificationHandling } from '@amruta/app-core';
import { OfflineQueueProvider } from '../../lib/offline';

export default function AppLayout() {
  useEffect(() => {
    setupNotificationHandling();
    void registerForPush('Staff app');
    return onNotificationTap(() => router.push('/alerts'));
  }, []);
  return (
    <OfflineQueueProvider>
      <LanguageSync />
      <Stack screenOptions={{ headerTitleAlign: 'center', headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </OfflineQueueProvider>
  );
}
