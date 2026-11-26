import { Alert, Platform } from 'react-native';
import * as Device from 'expo-device';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { rpc } from './api';
import { unregisterPush } from './push';

/**
 * Read the saved session. `offline: true` means it could NOT be checked (no
 * network while the access token needed refreshing): the person is still signed
 * in on this phone, so apps show their "offline, retry" screen, never sign-in.
 * Treating this as "signed out" let the owner app lock be skipped and wiped the
 * staff app's unsent deliveries (security review, Phase 7).
 */
export async function readSession(): Promise<{ session: Session | null; offline: boolean }> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) return { session: null, offline: isAuthRetryableFetchError(error) };
  return { session: data.session, offline: false };
}

/**
 * After a completed sign-in: tell the server, which alerts the person on their
 * other devices from the second sign-in on ("New sign-in to your account").
 * Never blocks or fails the sign-in.
 */
export async function recordSignIn(app: 'owner' | 'customer' | 'staff'): Promise<void> {
  const label = Platform.OS === 'web' ? 'a web browser' : (Device.modelName ?? (Platform.OS === 'ios' ? 'an iPhone' : 'an Android phone'));
  try { await rpc('record_sign_in', { p_app: app, p_label: label }); } catch { /* best effort */ }
}

export type SignOutResult = 'ok' | 'this-device-only';

/**
 * Sign out so that this phone is ALWAYS signed out afterwards, even without
 * network. "Everywhere" also stops alerts to the person's other phones and ends
 * their other sessions; if the server can't be reached, the result says so
 * (other phones were not signed out) instead of pretending.
 */
export async function signOutSafely(everywhere: boolean): Promise<SignOutResult> {
  let otherPhonesForgotten = !everywhere;
  if (everywhere) {
    try { await rpc('forget_other_devices', { p_keep: null }); otherPhonesForgotten = true; } catch { /* reported below */ }
  }
  await unregisterPush();
  const auth = getSupabase().auth;
  const { error } = await auth.signOut({ scope: everywhere ? 'global' : 'local' });
  if (error) {
    await auth.signOut({ scope: 'local' });   // removes this phone's session without asking the server
    return everywhere ? 'this-device-only' : 'ok';
  }
  return otherPhonesForgotten ? 'ok' : 'this-device-only';
}

export const SIGN_OUT_PARTIAL =
  'Signed out on this phone, but the server could not be reached, so your other devices are still signed in. ' +
  'Sign in again when you have signal and use "Sign out on all my devices" once more.';

/** A plain message box that works on phones and on the web. */
export function showMessage(title: string, message: string): void {
  if (Platform.OS === 'web') globalThis.alert?.(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}
