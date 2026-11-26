import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { LanguageSync, onNotificationTap, registerForPush, setupNotificationHandling } from '@amruta/app-core';

/** Everything after sign-in + authenticator. Titles are set by each screen. */
export default function AppLayout() {
  useEffect(() => {
    setupNotificationHandling();
    void registerForPush('Owner app');
    return onNotificationTap(() => router.push('/settings/alerts'));
  }, []);
  return (
    <>
      <LanguageSync />
      <Stack screenOptions={{ headerTitleAlign: 'center' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
