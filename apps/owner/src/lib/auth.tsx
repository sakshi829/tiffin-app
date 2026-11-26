import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { cols, type StaffMember } from '@amruta/shared';
import { envReady } from './env';
import { getSupabase } from './supabase';
import { run, toAppError } from './api';
import { readSession, signOutSafely, type SignOutResult } from '@amruta/app-core';

export type AuthState =
  | { status: 'needs-env' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'offline' }
  | { status: 'not-owner'; email: string }
  | { status: 'needs-mfa'; email: string; hasFactor: boolean }
  | { status: 'ready'; email: string; owner: StaffMember; kitchenId: string };

interface AuthApi {
  state: AuthState;
  refresh: () => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<SignOutResult>;
}

const AuthContext = createContext<AuthApi | null>(null);

async function evaluate(session: Session | null): Promise<AuthState> {
  if (!session) return { status: 'signed-out' };
  const supabase = getSupabase();
  const email = session.user.email ?? '';
  // Own staff row is readable even before MFA (RLS: user_id = auth.uid()).
  const owner = await run<StaffMember | null>(
    supabase.from('staff_members').select(cols('staff_members'))
      .eq('user_id', session.user.id).eq('role', 'owner').eq('active', true).maybeSingle(),
  );
  if (!owner) return { status: 'not-owner', email };
  const { data: aal, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw toAppError(error);
  if (aal.currentLevel !== 'aal2') return { status: 'needs-mfa', email, hasFactor: aal.nextLevel === 'aal2' };
  return { status: 'ready', email, owner, kitchenId: owner.kitchen_id };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(envReady ? { status: 'loading' } : { status: 'needs-env' });

  const refresh = useCallback(async () => {
    if (!envReady) return;
    const { session, offline } = await readSession();
    if (offline) { setState({ status: 'offline' }); return; }   // can't check now: NOT signed out
    try {
      setState(await evaluate(session));
    } catch {
      // Network or server problem: never fall through to "ready". With a saved
      // session, offer a retry instead of a needless new sign-in.
      setState(session ? { status: 'offline' } : { status: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    if (!envReady) return;
    void refresh();
    const { data } = getSupabase().auth.onAuthStateChange(() => {
      // Do not await Supabase calls inside this callback (can deadlock); defer instead.
      setTimeout(() => { void refresh(); }, 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async (everywhere = false): Promise<SignOutResult> => {
    const r = envReady ? await signOutSafely(everywhere) : 'ok';
    setState(envReady ? { status: 'signed-out' } : { status: 'needs-env' });
    return r;
  }, []);

  const value = useMemo(() => ({ state, refresh, signOut }), [state, refresh, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** For screens inside the signed-in area. */
export function useOwner(): { owner: StaffMember; kitchenId: string; email: string } {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useOwner used before sign-in completed');
  return { owner: state.owner, kitchenId: state.kitchenId, email: state.email };
}
