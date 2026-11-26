/**
 * Offline queue for staff actions (no signal in hospital basements / lifts).
 * Actions are saved on the phone and sent later. Every action is safe to send
 * twice (the database functions are idempotent), and the database still
 * checks every one, so the queue never bypasses a rule.
 */

export type QueuedKind = 'delivered' | 'not_delivered' | 'box_collected';

export interface QueuedAction {
  id: string;                    // also the idempotency key for box_collected
  kind: QueuedKind;
  orderId: string;
  reason?: string | null;
  boxCode?: string | null;
  queuedAt: number;
}

export interface QueueStore {
  load(): Promise<QueuedAction[]>;
  save(actions: QueuedAction[]): Promise<void>;
}

/** 'done' = accepted; 'retry' = no connection, keep it; 'drop' = refused by a rule (show the message). */
export type SendResult = { result: 'done' } | { result: 'retry' } | { result: 'drop'; message: string };

export const MAX_QUEUE = 200;

/** Add an action. A newer action for the same meal replaces an older one (last decision wins). */
export async function enqueue(store: QueueStore, action: QueuedAction): Promise<QueuedAction[]> {
  const list = await store.load();
  const sameMeal = (a: QueuedAction) => a.orderId === action.orderId && a.kind !== 'box_collected' && action.kind !== 'box_collected';
  const sameBox = (a: QueuedAction) => a.orderId === action.orderId && a.kind === 'box_collected' && action.kind === 'box_collected';
  const next = [...list.filter((a) => !sameMeal(a) && !sameBox(a)), action].slice(-MAX_QUEUE);
  await store.save(next);
  return next;
}

export interface FlushReport { sent: number; remaining: number; dropped: { action: QueuedAction; message: string }[] }

/** Send queued actions in order. Stops at the first 'retry' (still offline). */
export async function flushQueue(store: QueueStore, send: (a: QueuedAction) => Promise<SendResult>): Promise<FlushReport> {
  const list = await store.load();
  const report: FlushReport = { sent: 0, remaining: 0, dropped: [] };
  let i = 0;
  for (; i < list.length; i++) {
    const action = list[i]!;
    const r = await send(action);
    if (r.result === 'retry') break;
    if (r.result === 'done') report.sent += 1;
    else report.dropped.push({ action, message: r.message });
  }
  const remaining = list.slice(i);
  await store.save(remaining);
  report.remaining = remaining.length;
  return report;
}

/** In-memory store (tests, web fallback). */
export function memoryStore(initial: QueuedAction[] = []): QueueStore {
  let data = [...initial];
  return { load: async () => [...data], save: async (a) => { data = [...a]; } };
}
