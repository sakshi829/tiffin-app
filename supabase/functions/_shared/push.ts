// Pure push logic (no Deno/Node APIs) so it can be unit-tested with Node.
// Expo push API facts (docs.expo.dev/push-notifications/sending-notifications, Nov 2026):
//   - POST https://exp.host/--/api/v2/push/send, up to 100 messages per request
//   - response.data = tickets IN THE SAME ORDER as the messages
//   - ticket { status: 'ok', id } | { status: 'error', message, details: { error: 'DeviceNotRegistered' | ... } }

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
// Receipts: POST { ids: [...] } (up to 1000) -> { data: { [ticketId]: { status, details? } } }.
// Expo recommends checking ~15 min after sending; receipts are kept about a day.
export const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
export const MAX_PER_REQUEST = 100;
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export interface ClaimRow {
  notification_id: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  tokens: string[] | null;
  web?: { device_id: string; sub: unknown }[] | null;   // browser subscriptions (web app)
}

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: 'default';
  priority: 'high';
  channelId: 'default';
}

export interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushResult {
  id: string;
  status: 'sent' | 'retry' | 'failed' | 'no_device';
  invalid_tokens: string[];
  tickets: { id: string; token: string }[];   // accepted messages: their receipts are checked later
  invalid_web?: string[];                      // browser devices the push service says are gone
}

export interface WebOutcome { notificationId: string; deviceId: string; outcome: 'ok' | 'gone' | 'retry' }

/**
 * Combine phone (Expo) results with browser (web push) outcomes per alert:
 * sent if any device got it; retry if anything may still succeed; otherwise
 * failed (all gone) or no_device (nothing to send to).
 */
export function combineResults(expo: readonly PushResult[], web: readonly WebOutcome[]): PushResult[] {
  const byId = new Map(expo.map((r) => [r.id, { ...r }]));
  for (const w of web) {
    if (!byId.has(w.notificationId)) byId.set(w.notificationId, { id: w.notificationId, status: 'no_device', invalid_tokens: [], tickets: [] });
  }
  return [...byId.values()].map((r) => {
    const mine = web.filter((w) => w.notificationId === r.id);
    const invalidWeb = mine.filter((w) => w.outcome === 'gone').map((w) => w.deviceId);
    let status = r.status;
    if (r.status === 'sent' || mine.some((w) => w.outcome === 'ok')) status = 'sent';
    else if (r.status === 'retry' || mine.some((w) => w.outcome === 'retry')) status = 'retry';
    else if (r.status === 'no_device' && mine.length === 0) status = 'no_device';
    else status = 'failed';
    return { ...r, status, invalid_web: invalidWeb };
  });
}

/** One message per (notification, device). Rows without valid tokens are reported as no_device. */
export function buildMessages(rows: readonly ClaimRow[]): { messages: ExpoMessage[]; owners: string[]; noDevice: string[] } {
  const messages: ExpoMessage[] = [];
  const owners: string[] = [];
  const noDevice: string[] = [];
  for (const r of rows) {
    const tokens = [...new Set((r.tokens ?? []).filter((t) => TOKEN.test(t)))];
    if (tokens.length === 0) { noDevice.push(r.notification_id); continue; }
    for (const to of tokens) {
      messages.push({ to, title: r.title, body: r.body, data: r.data ?? {}, sound: 'default', priority: 'high', channelId: 'default' });
      owners.push(r.notification_id);
    }
  }
  return { messages, owners, noDevice };
}

export function chunk<T>(items: readonly T[], size = MAX_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface Outcome { notificationId: string; token: string; ticket: Ticket | null }  // null = request failed

/**
 * Per notification: 'sent' if any device accepted it; otherwise 'failed' when every
 * device is unregistered, else 'retry' (network / rate limit / server error).
 */
export function summarize(outcomes: readonly Outcome[], noDevice: readonly string[]): PushResult[] {
  const byId = new Map<string, Outcome[]>();
  for (const o of outcomes) byId.set(o.notificationId, [...(byId.get(o.notificationId) ?? []), o]);
  const results: PushResult[] = noDevice.map((id) => ({ id, status: 'no_device', invalid_tokens: [], tickets: [] }));
  for (const [id, list] of byId) {
    const invalid = list.filter((o) => o.ticket?.status === 'error' && o.ticket.details?.error === 'DeviceNotRegistered').map((o) => o.token);
    const anyOk = list.some((o) => o.ticket?.status === 'ok');
    const allUnregistered = invalid.length === list.length;
    const tickets = list.filter((o) => o.ticket?.status === 'ok' && typeof o.ticket.id === 'string' && o.ticket.id)
      .map((o) => ({ id: o.ticket!.id!, token: o.token }));
    results.push({ id, status: anyOk ? 'sent' : allUnregistered ? 'failed' : 'retry', invalid_tokens: invalid, tickets });
  }
  return results;
}

export interface Receipt { status: 'ok' | 'error'; message?: string; details?: { error?: string } }

/**
 * Which asked tickets have a receipt now (checked), and which of those say the app
 * was uninstalled (unregistered: remove that token). Tickets without a receipt yet
 * are asked again on a later run (until they are a day old).
 */
export function readReceipts(asked: readonly string[], data: Record<string, Receipt> | null | undefined): { checked: string[]; unregistered: string[] } {
  const checked: string[] = [];
  const unregistered: string[] = [];
  for (const id of asked) {
    const r = data?.[id];
    if (!r || (r.status !== 'ok' && r.status !== 'error')) continue;
    checked.push(id);
    if (r.status === 'error' && r.details?.error === 'DeviceNotRegistered') unregistered.push(id);
  }
  return { checked, unregistered };
}

/** Constant-time string comparison for the scheduler secret. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
