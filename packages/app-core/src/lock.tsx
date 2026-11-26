import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import { Body, Button, H1, Muted } from './ui/kit';
import { space, useColors } from './ui/theme';
import { useT } from './i18n';

/**
 * App lock (phones only). After 2 minutes in the background, or on launch with a
 * restored session, the app is covered until the phone's fingerprint, face or
 * PIN succeeds. Owner app: always on. Customer app: optional (Me › Lock the app).
 *
 * The launch lock is cleared ONLY by proving who you are: a completed email-code
 * sign-in or authenticator code (they call markFreshSignIn), or the phone's own
 * prompt. Merely looking "signed out" never clears it (Phase 7 security review).
 */
const RELOCK_AFTER_MS = 2 * 60 * 1000;

let freshSignIn = false;
const freshListeners = new Set<() => void>();
export function markFreshSignIn(): void {
  freshSignIn = true;
  freshListeners.forEach((f) => f());
}

/** Whether this phone has any screen lock (fingerprint/face or just a PIN/pattern). */
export async function deviceHasScreenLock(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/** Ask for the phone's fingerprint/face/PIN. */
export async function confirmWithDevice(prompt: string): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt });
  return r.success;
}

interface LockApi { lockNow: () => void; available: boolean | null }
const LockContext = createContext<LockApi>({ lockNow: () => {}, available: null });

/**
 * enabled: the signed-in area is showing.
 * active:  the lock is switched on (owner: always true; customer: their choice;
 *          null while the choice is still loading, which keeps the app covered).
 */
export function AppLock({ enabled, active = true, children }: { enabled: boolean; active?: boolean | null; children: ReactNode }) {
  const tr = useT();
  const c = useColors();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [locked, setLocked] = useState(Platform.OS !== 'web');
  const [message, setMessage] = useState<string | null>(null);
  const backgroundAt = useRef<number | null>(null);

  useEffect(() => {
    if (Platform.OS === 'web') { setAvailable(false); setLocked(false); return; }
    void (async () => {
      const ok = await deviceHasScreenLock();
      setAvailable(ok);
      if (!ok) setLocked(false);
    })();
  }, []);

  useEffect(() => {
    const clear = () => { freshSignIn = false; setLocked(false); };
    if (freshSignIn) clear();
    freshListeners.add(clear);
    return () => { freshListeners.delete(clear); };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') backgroundAt.current = Date.now();
      if (s === 'active' && backgroundAt.current && Date.now() - backgroundAt.current > RELOCK_AFTER_MS && available) {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, [available]);

  const unlock = useCallback(async () => {
    setMessage(null);
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Amruta's Kitchen" });
    if (r.success) setLocked(false);
    else if (r.error !== 'user_cancel' && r.error !== 'system_cancel') setMessage('Could not verify. Try again.');
  }, []);

  // Covered while unsure (lock status or the customer's choice still loading); never on the web.
  const showLock = Platform.OS !== 'web' && enabled && available !== false && active !== false && (locked || active === null);
  useEffect(() => { if (showLock && active === true && available === true) void unlock(); }, [showLock, active, available, unlock]);

  const lockNow = useCallback(() => { if (available) setLocked(true); }, [available]);

  // The lock COVERS the app (instead of unmounting it) so you return to the same screen.
  return (
    <LockContext.Provider value={{ lockNow, available }}>
      <View style={{ flex: 1 }} importantForAccessibility={showLock ? 'no-hide-descendants' : 'auto'}
        accessibilityElementsHidden={showLock}>
        {children}
      </View>
      {showLock ? (
        <View accessibilityViewIsModal
          style={[StyleSheet.absoluteFill, { backgroundColor: c.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }]}>
          {active === true && available === true ? (
            <>
              <H1>{tr('Locked')}</H1>
              <Body>{tr('Use your fingerprint, face or phone PIN to continue.')}</Body>
              {message ? <Muted>{message}</Muted> : null}
              <Button title={tr('Unlock')} onPress={() => void unlock()} />
            </>
          ) : null}
        </View>
      ) : null}
    </LockContext.Provider>
  );
}

export function useAppLock(): LockApi {
  return useContext(LockContext);
}

// ------------------------------------------------------------------ optional lock setting (customer app)
const SETTING_KEY = 'amruta-app-lock-on';
let settingCache: boolean | null = null;
const settingListeners = new Set<(on: boolean) => void>();

/** The customer's "lock the app" choice on this phone (null while loading). */
export function useAppLockSetting(): [boolean | null, (on: boolean) => Promise<void>] {
  const [on, setOn] = useState<boolean | null>(settingCache);
  useEffect(() => {
    const listener = (v: boolean) => setOn(v);
    settingListeners.add(listener);
    if (settingCache === null) {
      void AsyncStorage.getItem(SETTING_KEY).then((v) => { settingCache = v === '1'; settingListeners.forEach((l) => l(settingCache!)); })
        .catch(() => { settingCache = false; settingListeners.forEach((l) => l(false)); });
    }
    return () => { settingListeners.delete(listener); };
  }, []);
  const save = useCallback(async (v: boolean) => {
    await AsyncStorage.setItem(SETTING_KEY, v ? '1' : '0');
    settingCache = v;
    settingListeners.forEach((l) => l(v));
  }, []);
  return [on, save];
}
