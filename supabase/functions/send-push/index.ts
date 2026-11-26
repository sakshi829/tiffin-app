// Supabase Edge Function: deliver pending inbox notifications as phone pushes via Expo.
// Called every minute by pg_cron (see docs/SETUP_PERSONAL_LAPTOP.md step 11).
//
// Security:
//   - verify_jwt is OFF for this function (pg_cron has no user token); instead the
//     caller must send header `x-cron-secret` matching the CRON_SECRET function secret.
//     That secret can only trigger a send run; it grants no data access.
//   - The service key comes from the platform environment, never from the request.
//   - Uses push_claim / push_complete, which only the service role may execute.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';   // exact version: this code runs with the service key
import {
  buildMessages, chunk, combineResults, EXPO_PUSH_URL, EXPO_RECEIPTS_URL, readReceipts, safeEqual, summarize,
  type ClaimRow, type Outcome, type Receipt, type Ticket, type WebOutcome,
} from '../_shared/push.ts';
import { encryptPayload, importVapidKey, parseSubscription, vapidAuthorization, webPayload, webPushOutcome } from '../_shared/webpush.ts';

/** Web push to browsers (web app on iPhone / Android). Skipped unless the VAPID secrets are set. */
async function sendWebPushes(rows: ClaimRow[]): Promise<WebOutcome[]> {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
  const priv = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
  const subject = Deno.env.get('VAPID_SUBJECT') ?? '';
  if (!pub || !priv || !subject) return [];
  let key: CryptoKey;
  try { key = await importVapidKey(pub, priv); } catch { console.error('VAPID keys invalid'); return []; }
  const now = Math.floor(Date.now() / 1000);
  const out: WebOutcome[] = [];
  for (const r of rows) {
    for (const w of r.web ?? []) {
      const sub = parseSubscription(w.sub);
      if (!sub) { out.push({ notificationId: r.notification_id, deviceId: w.device_id, outcome: 'gone' }); continue; }   // not a real push service
      try {
        const body = await encryptPayload(sub, webPayload(r.title, r.body, r.data));
        const res = await fetch(sub.endpoint, {
          method: 'POST',
          redirect: 'error',                                   // never follow a push service elsewhere
          signal: AbortSignal.timeout(10_000),
          headers: {
            authorization: await vapidAuthorization(sub.endpoint, subject, pub, key, now),
            'content-encoding': 'aes128gcm',
            'content-type': 'application/octet-stream',
            ttl: '86400',
            urgency: 'high',
          },
          body,
        });
        out.push({ notificationId: r.notification_id, deviceId: w.device_id, outcome: webPushOutcome(res.status) });
      } catch (e) {
        console.error('web push failed', String(e).slice(0, 120));
        out.push({ notificationId: r.notification_id, deviceId: w.device_id, outcome: 'retry' });
      }
    }
  }
  return out;
}

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');            // new key model: JSON { default: "sb_secret_..." }
  if (keys) {
    try {
      const k = JSON.parse(keys)?.default;
      if (typeof k === 'string' && k) return k;
    } catch { /* fall through to legacy */ }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('No service key available');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const expected = Deno.env.get('CRON_SECRET') ?? '';
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', expected)) return new Response('Unauthorized', { status: 401 });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');     // optional "enhanced push security"
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;

  // 1. Receipts of messages sent 15 min .. 24 h ago: remove tokens of uninstalled apps (F22).
  let receiptsChecked = 0;
  try {
    const { data: due } = await db.rpc('push_receipts_due', { p_limit: 1000 });
    // setof text comes back as plain values; accept a one-column row too
    const ids = ((due ?? []) as unknown[])
      .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? String(Object.values(x)[0] ?? '') : ''))
      .filter(Boolean);
    if (ids.length > 0) {
      const res = await fetch(EXPO_RECEIPTS_URL, { method: 'POST', headers, body: JSON.stringify({ ids }) });
      if (res.ok) {
        const json = await res.json();
        const { checked, unregistered } = readReceipts(ids, json?.data as Record<string, Receipt> | undefined);
        if (checked.length > 0) {
          const { error: doneError } = await db.rpc('push_receipts_done', { p_checked: checked, p_unregistered: unregistered });
          if (doneError) console.error('push_receipts_done failed', doneError.message);
          else receiptsChecked = checked.length;
        }
      } else {
        console.error('expo receipts http', res.status);
      }
    }
  } catch (e) {
    console.error('receipts check failed', String(e));   // never blocks sending new alerts
  }

  // 2. Send new alerts.
  const { data, error } = await db.rpc('push_claim', { p_limit: 300 });
  if (error) {
    console.error('push_claim failed', error.message);
    return new Response('claim failed', { status: 500 });
  }
  const rows = (data ?? []) as ClaimRow[];
  const { messages, owners, noDevice } = buildMessages(rows);

  const outcomes: Outcome[] = [];
  const msgChunks = chunk(messages);
  const ownerChunks = chunk(owners);
  for (let c = 0; c < msgChunks.length; c++) {
    const part = msgChunks[c]!;
    let tickets: Ticket[] | null = null;
    try {
      const res = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(part) });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json?.data) && json.data.length === part.length) tickets = json.data as Ticket[];
      } else {
        console.error('expo push http', res.status);
      }
    } catch (e) {
      console.error('expo push request failed', String(e));
    }
    part.forEach((m, i) => outcomes.push({ notificationId: ownerChunks[c]![i]!, token: m.to, ticket: tickets ? tickets[i]! : null }));
  }

  const webOutcomes = await sendWebPushes(rows);
  const results = combineResults(summarize(outcomes, noDevice), webOutcomes);
  if (results.length > 0) {
    const { error: completeError } = await db.rpc('push_complete', { p_results: results });
    if (completeError) console.error('push_complete failed', completeError.message);
  }
  // No personal data in the response or logs: counts only.
  return Response.json({ claimed: rows.length, messages: messages.length, web: webOutcomes.length, results: results.length, receipts: receiptsChecked });
});
