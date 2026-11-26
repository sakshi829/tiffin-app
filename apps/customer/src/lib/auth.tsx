import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { run, readSession, signOutSafely, type SignOutResult } from '@amruta/app-core';
import { cols, type Customer } from '@amruta/shared';
import { envReady } from './env';
import { getSupabase } from './supabase';

/**
 * Customer journey: sign in (email code) -> redeem invite code -> accept the
 * kitchen's rules -> app. A login without a redeemed invite sees NOTHING
 * (enforced by the database, not by this screen).
 */
export type AuthState =
  | { status: 'needs-env' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'offline' }
  | { status: 'not-linked'; email: string }
  | { status: 'needs-terms'; email: string; customer: Customer }
  | { status: 'ready'; email: string; customer: Customer; kitchenId: string };

interface AuthApi {
  state: AuthState;
  refresh: () => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<SignOutResult>;
}

const AuthContext = createContext<AuthApi | null>(null);

async function evaluate(session: Session | null): Promise<AuthState> {
  if (!session) return { status: 'signed-out' };
  const email = session.user.email ?? '';
  // RLS returns only this person's own (non-archived) customer row.
  const customer = await run<Customer | null>(
    getSupabase().from('customers').select(cols('customers')).eq('user_id', session.user.id).limit(1).maybeSingle(),
  );
  if (!customer) return { status: 'not-linked', email };
  if (!customer.terms_accepted_at) return { status: 'needs-terms', email, customer };
  return { status: 'ready', email, customer, kitchenId: customer.kitchen_id };
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
      setState(session ? { status: 'offline' } : { status: 'signed-out' });
    }
  }, []);

  useEffect(() => {
    if (!envReady) return;
    void refresh();
    const { data } = getSupabase().auth.onAuthStateChange(() => {
      setTimeout(() => { void refresh(); }, 0);   // never await Supabase inside this callback
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

export function useMe(): { customer: Customer; kitchenId: string; email: string } {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useMe used before sign-in completed');
  return { customer: state.customer, kitchenId: state.kitchenId, email: state.email };
}
