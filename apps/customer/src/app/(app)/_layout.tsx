import { useEffect } from 'react';
import { router, Stack } from 'expo-router';
import { LanguageSync, onNotificationTap, registerForPush, setupNotificationHandling } from '@amruta/app-core';

export default function AppLayout() {
  useEffect(() => {
    setupNotificationHandling();
    void registerForPush('Customer app');          // asks permission once; harmless if denied/unsupported
    return onNotificationTap(() => router.push('/alerts'));
  }, []);
  return (
    <>
      <LanguageSync />
      <Stack screenOptions={{ headerTitleAlign: 'center', headerShadowVisible: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </>
  );
}
