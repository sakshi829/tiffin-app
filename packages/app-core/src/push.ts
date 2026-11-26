import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { rpc } from './api';
import { PUSH_DEVICE_KEY, unsubscribeBrowser } from './webpush';

/**
 * Phone push registration (Expo Push).
 * Facts from the Expo SDK 58 docs (checked Nov 2026):
 *  - remote push does NOT work in Expo Go (SDK 53+): needs a development or store build;
 *  - expo-notifications has no web push: web/PWA users rely on the in-app inbox;
 *  - Android: create the channel BEFORE asking for the token;
 *  - the token needs the EAS projectId (app config after `eas init`).
 */
const DEVICE_KEY = PUSH_DEVICE_KEY;

export type PushSetupResult = 'registered' | 'denied' | 'unsupported' | 'no-project-id' | 'error';

let handlerSet = false;
/** Show alerts while the app is open (call once at start-up). */
export function setupNotificationHandling(): void {
  if (Platform.OS === 'web' || handlerSet) return;
  handlerSet = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

export async function registerForPush(appLabel: string): Promise<PushSetupResult> {
  if (Platform.OS === 'web' || !Device.isDevice) return 'unsupported';
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', { name: 'Default', importance: Notifications.AndroidImportance.HIGH });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return 'denied';
    const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
    const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return 'no-project-id';
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const id = await rpc<string>('register_device', {
      p_platform: Platform.OS, p_expo_push_token: token, p_web_push: null, p_label: appLabel,
    });
    await AsyncStorage.setItem(DEVICE_KEY, id);
    return 'registered';
  } catch {
    return 'error';
  }
}

/** Before signing out: stop pushes for this person on this phone/browser. Never blocks sign-out. */
export async function unregisterPush(): Promise<void> {
  await unsubscribeBrowser();
  try {
    const id = await AsyncStorage.getItem(DEVICE_KEY);
    if (id) await rpc('unregister_device', { p_device: id });
  } catch { /* offline: the token is replaced at the next sign-in on this phone */ }
  await AsyncStorage.removeItem(DEVICE_KEY).catch(() => undefined);
}

/** Calls `onTap` when the user taps a notification (apps open their Alerts screen). */
export function onNotificationTap(onTap: (data: Record<string, unknown>) => void): () => void {
  if (Platform.OS === 'web') return () => undefined;
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onTap((response.notification.request.content.data ?? {}) as Record<string, unknown>);
  });
  return () => sub.remove();
}
