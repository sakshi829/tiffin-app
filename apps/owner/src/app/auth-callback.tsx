import { useCallback } from 'react';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { AuthCallbackScreen, recordSignIn } from '@amruta/app-core';
import { markFreshSignIn } from '../lib/lock';

/** Google sign-in comes back here (web redirect, or a phone deep link). */
export default function AuthCallback() {
  const p = useLocalSearchParams<{ code?: string; error?: string }>();
  const onSignedIn = useCallback(() => { markFreshSignIn(); void recordSignIn('owner'); }, []);
  const goHome = useCallback(() => router.replace('/'), []);
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <AuthCallbackScreen code={p.code} error={p.error} onSignedIn={onSignedIn} goHome={goHome} />
    </>
  );
}
