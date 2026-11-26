// The client lives in @amruta/app-core (shared by all apps); this app supplies its config.
import { configureSupabase, getSupabase } from '@amruta/app-core';
import { envReady, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

if (envReady) configureSupabase(SUPABASE_URL, SUPABASE_ANON_KEY);

export { getSupabase };
