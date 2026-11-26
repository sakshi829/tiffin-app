import 'react-native-url-polyfill/auto';
import 'react-native-get-random-values';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as aesjs from 'aes-js';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

/**
 * Session storage on phones (pattern from Supabase's Expo guide):
 * a fresh AES-256 key is kept in the device keystore (SecureStore) and the
 * encrypted session in AsyncStorage, so the session is never stored in plain text.
 * On web, Supabase's default (browser localStorage) is used.
 */
class LargeSecureStore {
  private async encrypt(key: string, value: string): Promise<string> {
    const encryptionKey = globalThis.crypto.getRandomValues(new Uint8Array(256 / 8));
    const cipher = new aesjs.ModeOfOperation.ctr(encryptionKey, new aesjs.Counter(1));
    const encryptedBytes = cipher.encrypt(aesjs.utils.utf8.toBytes(value));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encryptionKey));
    return aesjs.utils.hex.fromBytes(encryptedBytes);
  }

  private async decrypt(key: string, value: string): Promise<string | null> {
    const encryptionKeyHex = await SecureStore.getItemAsync(key);
    if (!encryptionKeyHex) return null;
    const cipher = new aesjs.ModeOfOperation.ctr(aesjs.utils.hex.toBytes(encryptionKeyHex), new aesjs.Counter(1));
    return aesjs.utils.utf8.fromBytes(cipher.decrypt(aesjs.utils.hex.toBytes(value)));
  }

  async getItem(key: string): Promise<string | null> {
    const encrypted = await AsyncStorage.getItem(key);
    if (!encrypted) return null;
    return this.decrypt(key, encrypted);
  }

  async setItem(key: string, value: string): Promise<void> {
    const encrypted = await this.encrypt(key, value);
    await AsyncStorage.setItem(key, encrypted);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}

// https for Supabase cloud; plain http only for a local Supabase on this computer/emulator.
const URL_OK = /^(https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(:\d{2,5})?)$/;

export function isValidSupabaseConfig(url: string, anonKey: string): boolean {
  return URL_OK.test(url) && anonKey.length > 20;
}

let config: { url: string; anonKey: string } | null = null;
let client: SupabaseClient | null = null;

/** Each app calls this once with its PUBLIC url + anon key (from its own EXPO_PUBLIC_* env). */
export function configureSupabase(url: string, anonKey: string): void {
  if (!isValidSupabaseConfig(url, anonKey)) throw new Error('Invalid Supabase configuration');
  config = { url, anonKey };
}

export function getSupabase(): SupabaseClient {
  if (!config) throw new Error('Supabase is not configured (see docs/SETUP_PERSONAL_LAPTOP.md).');
  if (!client) {
    client = createClient(config.url, config.anonKey, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : new LargeSecureStore(),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
        flowType: 'pkce',   // Google sign-in: the code in the return link only works with this app's secret
      },
    });
    if (Platform.OS !== 'web') {
      // Refresh tokens only while the app is in the foreground (Supabase guidance). Registered once.
      AppState.addEventListener('change', (state) => {
        if (state === 'active') void client?.auth.startAutoRefresh();
        else void client?.auth.stopAutoRefresh();
      });
    }
  }
  return client;
}
