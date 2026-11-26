import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider, Loading, useNavigationColors, useT } from '@amruta/app-core';
import { AuthProvider, useAuth } from '../lib/auth';
import { AppLock, useAppLockSetting } from '@amruta/app-core/src/lock';
import { startErrorReporting } from '@amruta/app-core';
import { SENTRY_DSN } from '../lib/env';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// Crash reports only if a Sentry DSN is configured; personal data is stripped first.
startErrorReporting('customer', SENTRY_DSN);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const nav = useNavigationColors();
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <ThemeProvider value={{ ...base, colors: { ...base.colors, ...nav } }}>
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

/** One group of screens per sign-in state (expo-router protected routes). */
function Gate() {
  const { state } = useAuth();
  const s = state.status;
  const [lockOn] = useAppLockSetting();   // optional: Me › Lock the app
  const tr = useT();
  useEffect(() => { if (s !== 'ready') queryClient.clear(); }, [s]);
  if (s === 'loading') return <Loading />;
  return (
    <AppLock enabled={s === 'ready'} active={lockOn}>
    <Stack screenOptions={{ headerTitleAlign: 'center', headerShadowVisible: false }}>
      <Stack.Protected guard={s === 'needs-env'}>
        <Stack.Screen name="setup-needed" options={{ title: tr('Setup needed') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'signed-out'}>
        <Stack.Screen name="sign-in" options={{ title: tr("Amruta's Kitchen") }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'offline'}>
        <Stack.Screen name="offline" options={{ title: tr("Amruta's Kitchen") }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'not-linked'}>
        <Stack.Screen name="join" options={{ title: tr('Join') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'needs-terms'}>
        <Stack.Screen name="terms" options={{ title: tr('Kitchen rules') }} />
      </Stack.Protected>
      <Stack.Protected guard={s === 'ready'}>
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
    </AppLock>
  );
}
