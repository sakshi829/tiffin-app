import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { newIdempotencyKey, rpc, toAppError } from '@amruta/app-core';
import { enqueue, flushQueue, type QueuedAction, type QueuedKind, type QueueStore, type SendResult } from '@amruta/shared';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Every staff action goes through this queue: it is sent immediately when
 * there is signal, otherwise saved on the phone and retried (on app resume,
 * every 30 s, or "Send now"). Stored: action type, meal id, reason. No
 * personal data.
 */
const KEY = 'amruta-staff-queue-v1';

const store: QueueStore = {
  load: async () => {
    try { return JSON.parse((await AsyncStorage.getItem(KEY)) ?? '[]') as QueuedAction[]; } catch { return []; }
  },
  save: async (actions) => { await AsyncStorage.setItem(KEY, JSON.stringify(actions)); },
};

async function send(a: QueuedAction): Promise<SendResult> {
  try {
    if (a.kind === 'delivered') await rpc('staff_mark_delivered', { p_order: a.orderId });
    else if (a.kind === 'not_delivered') await rpc('staff_mark_not_delivered', { p_order: a.orderId, p_reason: a.reason ?? '' });
    else await rpc('staff_box_collected', { p_order: a.orderId, p_box_code: a.boxCode ?? null, p_idempotency_key: a.id });
    return { result: 'done' };
  } catch (e) {
    const err = toAppError(e);
    if (err.code === 'NETWORK') return { result: 'retry' };
    return { result: 'drop', message: err.message };
  }
}

const OWNER_KEY = 'amruta-staff-queue-user';

/** Called on an explicit sign-out: queued actions belong to the person who made them. */
export async function clearQueue(): Promise<void> {
  await AsyncStorage.multiRemove([KEY, OWNER_KEY]);
}

/**
 * Called when someone is signed in and ready. If a DIFFERENT person's unsent
 * actions are still on this phone, they are discarded (never sent as this
 * person). The same person's actions are kept, even across an offline restart.
 */
export async function claimQueue(userId: string): Promise<void> {
  const previous = await AsyncStorage.getItem(OWNER_KEY);
  if (previous && previous !== userId) await AsyncStorage.removeItem(KEY);
  if (previous !== userId) await AsyncStorage.setItem(OWNER_KEY, userId);
}

interface QueueApi {
  pending: QueuedAction[];
  problems: string[];
  act: (kind: QueuedKind, orderId: string, extra?: { reason?: string; boxCode?: string }) => Promise<void>;
  flushNow: () => Promise<void>;
  clearProblems: () => void;
}
const QueueContext = createContext<QueueApi | null>(null);

export function OfflineQueueProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<QueuedAction[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const flushing = useRef(false);

  const flushNow = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const report = await flushQueue(store, send);
      if (report.dropped.length) setProblems((p) => [...p, ...report.dropped.map((d) => d.message)]);
      if (report.sent || report.dropped.length) await qc.invalidateQueries({ queryKey: ['staff'] });
    } finally {
      flushing.current = false;
      setPending(await store.load());
    }
  }, [qc]);

  const act = useCallback(async (kind: QueuedKind, orderId: string, extra?: { reason?: string; boxCode?: string }) => {
    await enqueue(store, { id: newIdempotencyKey(), kind, orderId, reason: extra?.reason ?? null, boxCode: extra?.boxCode ?? null, queuedAt: Date.now() });
    setPending(await store.load());
    await flushNow();
  }, [flushNow]);

  useEffect(() => {
    void flushNow();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void flushNow(); });
    const id = setInterval(() => { void flushNow(); }, 30_000);
    return () => { sub.remove(); clearInterval(id); };
  }, [flushNow]);

  return (
    <QueueContext.Provider value={{ pending, problems, act, flushNow, clearProblems: () => setProblems([]) }}>
      {children}
    </QueueContext.Provider>
  );
}

export function useOfflineQueue(): QueueApi {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error('useOfflineQueue outside OfflineQueueProvider');
  return ctx;
}
