import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { run, readSession, signOutSafely, type SignOutResult } from '@amruta/app-core';
import { clearQueue } from './offline';
import { cols, type StaffMember } from '@amruta/shared';
import { envReady } from './env';
import { getSupabase } from './supabase';

/**
 * Staff journey: sign in (email code) -> redeem the STAFF invite -> work.
 * What staff can see is decided by the database (only their own tasks).
 */
export type AuthState =
  | { status: 'needs-env' }
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'offline' }
  | { status: 'not-linked'; email: string }
  | { status: 'no-access'; email: string; reason: 'removed' | 'owner' }
  | { status: 'ready'; email: string; staff: StaffMember; kitchenId: string };

interface AuthApi { state: AuthState; refresh: () => Promise<void>; signOut: (everywhere?: boolean) => Promise<SignOutResult> }
const AuthContext = createContext<AuthApi | null>(null);

async function evaluate(session: Session | null): Promise<AuthState> {
  if (!session) return { status: 'signed-out' };
  const email = session.user.email ?? '';
  // RLS: a person can always read their own staff rows.
  const rows = await run<StaffMember[]>(
    getSupabase().from('staff_members').select(cols('staff_members')).eq('user_id', session.user.id),
  );
  const work = rows.filter((r) => r.role !== 'owner');
  const active = work.find((r) => r.active);
  if (active) return { status: 'ready', email, staff: active, kitchenId: active.kitchen_id };
  if (work.length > 0) return { status: 'no-access', email, reason: 'removed' };
  if (rows.some((r) => r.role === 'owner')) return { status: 'no-access', email, reason: 'owner' };
  return { status: 'not-linked', email };
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
    const { data } = getSupabase().auth.onAuthStateChange(() => { setTimeout(() => { void refresh(); }, 0); });
    return () => data.subscription.unsubscribe();
  }, [refresh]);

  const signOut = useCallback(async (everywhere = false): Promise<SignOutResult> => {
    const r = envReady ? await signOutSafely(everywhere) : 'ok';
    await clearQueue();   // an explicit sign-out (the Me screen warns first if anything is unsent)
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

export function useStaffMe(): { staff: StaffMember; kitchenId: string; email: string } {
  const { state } = useAuth();
  if (state.status !== 'ready') throw new Error('useStaffMe used before sign-in completed');
  return { staff: state.staff, kitchenId: state.kitchenId, email: state.email };
}

export const isKitchenRole = (s: StaffMember) => s.role === 'kitchen' || s.role === 'kitchen_delivery';
export const isDeliveryRole = (s: StaffMember) => s.role === 'delivery' || s.role === 'kitchen_delivery';
