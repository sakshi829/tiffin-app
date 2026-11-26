import { isValidSupabaseConfig } from '@amruta/app-core';

// Public configuration only (inlined at build time). Real values go in
// apps/staff/.env.local on your PERSONAL laptop (never commit it).
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const envReady = isValidSupabaseConfig(SUPABASE_URL, SUPABASE_ANON_KEY);

/** Public key for alerts in the web app (from scripts/vapid-keys.mjs). Empty = web alerts off. */
export const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY ?? '';

/** Optional crash/error reports (Sentry). Empty = off. */
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** "on" shows Continue with Google (set up the Google provider in Supabase first: Setup step 20). */
export const GOOGLE_SIGNIN = process.env.EXPO_PUBLIC_GOOGLE_SIGNIN === 'on';
