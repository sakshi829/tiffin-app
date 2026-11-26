import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { getSupabase } from './supabase';
import { AppError } from './api';
import { Button, ErrorText, Loading, Muted, Screen, useAction } from './ui/kit';
import { useT } from './i18n';

/**
 * "Continue with Google" (F1). Supabase OAuth with PKCE: Google sends back a one-time
 * code that only this app can swap for a session (it holds the matching secret), so a
 * link intercepted by another app is useless. Phones: in-app browser sheet. Web: a normal
 * redirect that comes back to /auth-callback. Shown only when the app's
 * EXPO_PUBLIC_GOOGLE_SIGNIN is "on" (Supabase must have the Google provider set up first).
 * A Google account is the same person as an email-code account with the same address.
 */

/** Where Google sends people back: amrutaskitchen://auth-callback, akowner://…, or https://<site>/auth-callback. */
export const authCallbackUrl = (): string => Linking.createURL('auth-callback');

type Finish = 'done' | 'already' | 'none';
const handled = new Set<string>();   // the same code can arrive twice (browser sheet result + deep link)

/** Swaps the code in a return link for a session. 'done' only for the call that did it. */
export async function finishGoogleSignIn(url: string): Promise<Finish> {
  let code: string | null = null;
  let failed = false;
  try {
    const u = new URL(url);
    code = u.searchParams.get('code');
    failed = u.searchParams.has('error');
  } catch { return 'none'; }
  if (failed) throw new AppError('SIGN_IN_FAILED');
  if (!code) return 'none';
  if (handled.has(code)) return 'already';
  handled.add(code);
  const { error } = await getSupabase().auth.exchangeCodeForSession(code);
  if (error) throw new AppError('SIGN_IN_FAILED', error);
  return 'done';
}

/** Starts Google sign-in. Resolves true when this call signed the person in (phones); on the web the page leaves. */
export async function signInWithGoogle(): Promise<boolean> {
  const sb = getSupabase();
  const redirectTo = authCallbackUrl();
  if (Platform.OS === 'web') {
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    if (error) throw new AppError('SIGN_IN_FAILED', error);
    return false;
  }
  const { data, error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data?.url) throw new AppError('SIGN_IN_FAILED', error ?? undefined);
  const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (res.type !== 'success') return false;            // closed or cancelled by the person
  return (await finishGoogleSignIn(res.url)) === 'done';
}

/** The button on a sign-in screen. `onSignedIn` runs once (sign-in alert, no app-lock prompt right after). */
export function GoogleSignInButton({ onSignedIn }: { onSignedIn: () => void }) {
  const tr = useT();
  const go = useAction(async () => { if (await signInWithGoogle()) onSignedIn(); });
  return (
    <>
      <Button title={tr('Continue with Google')} variant="secondary" onPress={() => void go.run()} loading={go.busy} />
      <ErrorText error={go.error} />
    </>
  );
}

/**
 * Screen for /auth-callback: finishes a web sign-in (and a phone deep link that arrives
 * before the browser sheet reports back), then goes to the start screen.
 */
export function AuthCallbackScreen({ code, error: googleError, onSignedIn, goHome }: {
  code?: string; error?: string; onSignedIn: () => void; goHome: () => void;
}) {
  const tr = useT();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams();
    if (code) query.set('code', code);
    if (googleError) query.set('error', googleError);
    finishGoogleSignIn(`${authCallbackUrl()}?${query.toString()}`)
      .then((r) => { if (!alive) return; if (r === 'done') onSignedIn(); goHome(); })
      .catch((e: unknown) => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [code, googleError, onSignedIn, goHome]);
  return (
    <Screen>
      {error ? (
        <>
          <ErrorText error={error} />
          <Button title={tr('Back to sign-in')} onPress={goHome} />
        </>
      ) : (
        <>
          <Loading />
          <Muted>{tr('Signing you in…')}</Muted>
        </>
      )}
    </Screen>
  );
}
