import { useEffect } from 'react';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useColorScheme } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '../lib/auth';
import { StepUpProvider } from '../lib/stepup';
import { AppLock } from '../lib/lock';
import { ScreenPrivacy } from '../lib/screen-privacy';
import { Loading } from '../ui/kit';
import { LanguageProvider, startErrorReporting, useNavigationColors, useT } from '@amruta/app-core';
import { SENTRY_DSN } from '../lib/env';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

// Crash reports only if a Sentry DSN is configured; personal data is stripped first.
startErrorReporting('owner', SENTRY_DSN);

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const nav = useNavigationColors();
  const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <LanguageProvider>
    <ThemeProvider value={{ ...base, colors: { ...base.colors, ...nav } }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StepUpProvider>
            <Gate />
          </StepUpProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
    </LanguageProvider>
  );
}

/** Exactly one group of screens exists for each auth state (expo-router protected routes). */
function Gate() {
  const tr = useT();
  const { state } = useAuth();
  const s = state.status;

  // Never keep another session's data in memory.
  useEffect(() => { if (s !== 'ready') queryClient.clear(); }, [s]);

  if (s === 'loading') return <Loading />;
  return (
    <AppLock enabled={s === 'ready'}>
      {s === 'ready' ? <ScreenPrivacy /> : null}
      <Stack screenOptions={{ headerTitleAlign: 'center', headerShadowVisible: false }}>
        <Stack.Protected guard={s === 'needs-env'}>
          <Stack.Screen name="setup-needed" options={{ title: tr('Setup needed') }} />
        </Stack.Protected>
        <Stack.Protected guard={s === 'signed-out'}>
          <Stack.Screen name="sign-in" options={{ title: tr('Amruta\'s Kitchen') }} />
        </Stack.Protected>
        <Stack.Protected guard={s === 'offline'}>
          <Stack.Screen name="offline" options={{ title: tr('Amruta\'s Kitchen') }} />
        </Stack.Protected>
        <Stack.Protected guard={s === 'needs-mfa'}>
          <Stack.Screen name="mfa" options={{ title: tr('Authenticator app') }} />
        </Stack.Protected>
        <Stack.Protected guard={s === 'not-owner'}>
          <Stack.Screen name="not-owner" options={{ title: tr('No access') }} />
        </Stack.Protected>
        <Stack.Protected guard={s === 'ready'}>
          <Stack.Screen name="(app)" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </AppLock>
  );
}
