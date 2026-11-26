import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * Owner screens show every customer's phone and balance. On phones, screenshots
 * are blocked and the recent-apps preview is blank (Android FLAG_SECURE), unless
 * the owner allows screenshots on this phone (More › Security). No effect on the web.
 */
const KEY = 'amruta-owner-allow-screenshots';
let allowCache: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

export function useAllowScreenshots(): [boolean, (v: boolean) => Promise<void>] {
  const [allow, setAllow] = useState(allowCache ?? false);
  useEffect(() => {
    const l = (v: boolean) => setAllow(v);
    listeners.add(l);
    if (allowCache === null) {
      void AsyncStorage.getItem(KEY).then((v) => { allowCache = v === '1'; listeners.forEach((x) => x(allowCache!)); }).catch(() => undefined);
    }
    return () => { listeners.delete(l); };
  }, []);
  const save = async (v: boolean) => {
    await AsyncStorage.setItem(KEY, v ? '1' : '0');
    allowCache = v;
    listeners.forEach((x) => x(v));
  };
  return [allow, save];
}

export function ScreenPrivacy() {
  const [allow] = useAllowScreenshots();
  useEffect(() => {
    if (Platform.OS === 'web' || allow) return;
    ScreenCapture.preventScreenCaptureAsync('owner').catch(() => undefined);
    return () => { ScreenCapture.allowScreenCaptureAsync('owner').catch(() => undefined); };
  }, [allow]);
  return null;
}
