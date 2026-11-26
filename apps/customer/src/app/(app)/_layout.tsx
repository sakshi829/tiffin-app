import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { LanguageSync, onNotificationTap, registerForPush, setupNotificationHandling, useT } from '@amruta/app-core';

// A screen opened by its web address or after a reload still has the tabs underneath it,
// so its header shows a back arrow (expo-router 58: unstable_settings.anchor).
export const unstable_settings = { anchor: '(tabs)' };

export default function AppLayout() {
  const tr = useT();   // the back arrow reads "Amruta's Kitchen, back", not "(tabs), back"
  useEffect(() => {
    setupNotificationHandling();
    void registerForPush('Customer app');          // asks permission once; harmless if denied/unsupported
    return onNotificationTap(() => router.push('/alerts'));
  }, []);
  return (
    <>
      <LanguageSync />
      <Stack screenOptions={{ headerTitleAlign: 'center', headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, title: tr("Amruta's Kitchen") }} />
      </Stack>
    </>
  );
}
