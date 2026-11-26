import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { rpc } from './api';

/**
 * Alerts for the WEB app (iPhone home-screen app, Android/desktop browsers).
 * Phones with the installed Android app use Expo push instead (push.ts).
 *
 * iPhone rules (Apple, iOS 16.4+): alerts work only after "Add to Home Screen",
 * and permission can only be asked from a tap. So the Alerts screen shows a
 * button; nothing is asked automatically.
 */
export type WebAlertsState = 'unsupported' | 'install-first' | 'blocked' | 'off' | 'on';

export const PUSH_DEVICE_KEY = 'amruta-push-device-id';   // same key as push.ts, so sign-out removes it

const isWeb = () => Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';

export function isIosBrowser(): boolean {
  if (!isWeb()) return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isInstalledWebApp(): boolean {
  if (!isWeb()) return false;
  return window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function keyBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64url.replaceAll('-', '+').replaceAll('_', '/') + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function webAlertsState(): Promise<WebAlertsState> {
  if (!isWeb()) return 'unsupported';
  if (isIosBrowser() && !isInstalledWebApp()) return 'install-first';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Call from a button tap. Asks permission, subscribes this browser and saves it for this person. */
export async function enableWebAlerts(vapidPublicKey: string, label: string): Promise<WebAlertsState> {
  if (!/^[A-Za-z0-9_-]{87}$/.test(vapidPublicKey)) return 'unsupported';   // not configured (Setup step 17)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription())
    ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) });
  const id = await rpc<string>('register_device', { p_platform: 'web', p_expo_push_token: null, p_web_push: sub.toJSON(), p_label: label });
  await AsyncStorage.setItem(PUSH_DEVICE_KEY, id);
  return 'on';
}

/** On sign-out or "turn off": this browser stops receiving pushes. Never throws. */
export async function unsubscribeBrowser(): Promise<void> {
  if (!isWeb() || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    await sub?.unsubscribe();
  } catch { /* already gone */ }
}
