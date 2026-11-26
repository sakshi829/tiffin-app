import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, Loading, useT } from '@amruta/app-core';
import { AuthProvider, useAuth } from '../lib/auth';
import { claimQueue, clearQueue } from '../lib/offline';
import { startErrorReporting } from '@amruta/app-core';
import { SENTRY_DSN } from '../lib/env';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: 1 } } });

// Crash reports only if a Sentry DSN is configured; personal data is stripped first.
startErrorReporting('staff', SENTRY_DSN);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider>
          <AuthProvider>
            <Gate />
          </AuthProvider>
        </LanguageProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

function Gate() {
  const tr = useT();
  const { state } = useAuth();
  const s = state.status;
  useEffect(() => {
    if (s !== 'ready') queryClient.clear();
    // Not on "signed-out": a session that couldn't be read offline must not lose unsent deliveries.
    if (s === 'no-access' || s === 'not-linked') void clearQueue();
    if (state.status === 'ready') void claimQueue(state.staff.user_id);
  }, [s]);
  if (s === 'loading') return <Loading />;
  return (
    <Stack screenOptions={{ headerTitleAlign: 'center' }}>
      <Stack.Protected guard={s === 'needs-env'}>
        <Stack.Screen name="setup-needed" options={{ title: tr('Setup needed') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'signed-out'}>
        <Stack.Screen name="sign-in" options={{ title: tr('AK Staff') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'offline'}>
        <Stack.Screen name="offline" options={{ title: tr('AK Staff') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'not-linked'}>
        <Stack.Screen name="join" options={{ title: tr('Join') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'no-access'}>
        <Stack.Screen name="no-access" options={{ title: tr('No access') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'ready'}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
