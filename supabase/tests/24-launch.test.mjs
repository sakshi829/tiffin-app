// Phase 7b: push receipts (F22), new sign-in alert (F24), forgetting deleted files
// (F32), unused receipt clean-up (F33), meals-by-weekday heatmap (F36).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const TA = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const TB = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

test('push receipts: checked after 15 minutes; an uninstalled app\'s token is removed; only the service can do it', async () => {
  await t.call(u.custA, 'public.register_device($1, $2, null, null)', ['android', TA]);
  await t.call(u.custB, 'public.register_device($1, $2, null, null)', ['android', TB]);
  const results = [{ id: randomUUID(), status: 'sent', invalid_tokens: [], tickets: [{ id: 'tk-a', token: TA }, { id: 'tk-b', token: TB }] }];
  await t.asService('select public.push_complete($1::jsonb)', [JSON.stringify(results)]);
  assert.deepEqual(await t.asService('select * from public.push_receipts_due(100)'), []);          // too early
  await t.setNow('2026-12-01T03:50:00Z');                                                          // +20 min
  const due = (await t.asService('select * from public.push_receipts_due(100) as id')).map((r) => r.id).sort();
  assert.deepEqual(due, ['tk-a', 'tk-b']);
  const [{ removed }] = await t.asService(`select public.push_receipts_done($1::text[], $2::text[]) as removed`, ['{tk-a,tk-b}', '{tk-a}']);
  assert.equal(removed, 1);
  assert.deepEqual((await t.sql('select expo_push_token from public.devices order by 1')).map((r) => r.expo_push_token), [TB]);
  assert.deepEqual(await t.asService('select * from public.push_receipts_due(100)'), []);
  // tickets older than a day are simply dropped (Expo keeps receipts ~24 h)
  await t.asService('select public.push_complete($1::jsonb)', [JSON.stringify([{ id: randomUUID(), status: 'sent', invalid_tokens: [], tickets: [{ id: 'tk-old', token: TB }] }])]);
  await t.setNow('2026-12-02T05:00:00Z');
  assert.deepEqual(await t.asService('select * from public.push_receipts_due(100)'), []);
  assert.equal((await t.sql('select count(*)::int n from app.push_tickets'))[0].n, 0);
  for (const user of [u.owner, u.custA]) {
    await rejects(t.as(user, 'select * from public.push_receipts_due(10)'), 'permission denied');
    await rejects(t.as(user, `select public.push_receipts_done('{}', '{}')`), 'permission denied');
    await rejects(t.as(user, 'select * from app.push_tickets'), 'permission denied');
  }
  await t.setNow('2026-12-01T03:30:00Z');
});

test('new sign-in alert: not on the first sign-in, then on every new one; own account only; cannot be muted', async () => {
  const alerts = (user) => t.as(user, `select title, body from public.notifications where kind = 'new_sign_in'`);
  await t.call(u.custA, 'public.record_sign_in($1, $2)', ['customer', 'Pixel 8']);
  assert.equal((await alerts(u.custA)).length, 0);
  await t.call(u.custA, 'public.record_sign_in($1, $2)', ['customer', '<b>iPhone</b> Safari']);
  const got = await alerts(u.custA);
  assert.equal(got.length, 1);
  assert.equal(got[0].title, 'New sign-in to your account');
  assert.match(got[0].body, /^Signed in on .*iPhone.* at \d{1,2}:\d{2} [AP]M, 01 Dec\. Not you\?/);
  assert.equal((await alerts(u.custB)).length, 0);
  await t.call(u.owner, 'public.record_sign_in($1, $2)', ['owner', 'Chrome']);
  await t.call(u.owner, 'public.record_sign_in($1, $2)', ['owner', 'Chrome']);
  assert.equal((await alerts(u.owner)).length, 1);
  await rejects(t.call(u.custA, 'public.record_sign_in($1, $2)', ['admin', 'x']), 'INVALID_REQUEST');
  await rejects(t.as(null, `select public.record_sign_in('customer', 'x')`), 'permission denied');
  await rejects(t.call(u.custA, 'public.set_notification_prefs($1::text[])', ['{new_sign_in}']), 'INVALID_SETTING');
  for (let i = 0; i < 10; i++) await t.call(u.custB, 'public.record_sign_in($1, $2)', ['customer', 'x']);
  await rejects(t.call(u.custB, 'public.record_sign_in($1, $2)', ['customer', 'x']), 'TOO_MANY_REQUESTS');
  await rejects(t.as(u.custA, 'select * from app.sign_ins'), 'permission denied');
});

test('after the clean-up deletes files, their references disappear (no "photo no longer available")', async () => {
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  const proof = `${w.k1}/${w.cust.A}/${o.id}.jpg`;
  const voice = `${w.k1}/${w.cust.A}/${randomUUID()}.webm`;
  const shot = `${w.k1}/${w.cust.A}/${randomUUID()}.jpg`;
  await t.sql('insert into public.delivery_proofs (order_id, kitchen_id, customer_id, path) values ($1, $2, $3, $4)', [o.id, w.k1, w.cust.A, proof]);
  await t.sql(`insert into public.chat_messages (kitchen_id, customer_id, sender_role, body, voice_path, voice_seconds)
               values ($1, $2, 'customer', 'Voice note', $3, 5)`, [w.k1, w.cust.A, voice]);
  const pay = await t.call(u.custA, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)', [w.k1, 'UTR778899', '2026-12-01', 'k-forget-001']);
  await t.sql('update public.payments set proof_path = $1 where id = $2', [shot, pay.payment_id]);
  const items = [{ bucket: 'delivery-proofs', name: proof }, { bucket: 'voice-notes', name: voice }, { bucket: 'payment-proofs', name: shot },
    { bucket: 'kitchen-media', name: `${w.k1}/qr.png` }];
  await rejects(t.as(u.owner, 'select public.media_forget($1::jsonb)', [JSON.stringify(items)]), 'permission denied');
  const [{ n }] = await t.asService('select public.media_forget($1::jsonb) as n', [JSON.stringify(items)]);
  assert.equal(n, 3);
  assert.equal((await t.sql('select count(*)::int n from public.delivery_proofs where order_id = $1', [o.id]))[0].n, 0);
  assert.deepEqual((await t.sql('select voice_path, voice_seconds, body from public.chat_messages where customer_id = $1', [w.cust.A]))[0],
    { voice_path: null, voice_seconds: null, body: 'Voice note' });
  assert.equal((await t.sql('select proof_path from public.payments where id = $1', [pay.payment_id]))[0].proof_path, null);
});

test('receipt photos nobody saved an expense with are cleaned up after 2 days; saved ones never', async () => {
  const [{ id: cat }] = await t.sql('select id from public.expense_categories where kitchen_id = $1 limit 1', [w.k1]);
  const orphanOld = `${w.k1}/${randomUUID()}.jpg`;
  const orphanNew = `${w.k1}/${randomUUID()}.jpg`;
  const kept = `${w.k1}/${randomUUID()}.jpg`;
  for (const [name, age] of [[orphanOld, '3 days'], [orphanNew, '1 hour'], [kept, '30 days']]) {
    await t.sql(`insert into storage.objects (bucket_id, name, created_at) values ('receipts', $1, app.now() - $2::interval)`, [name, age]);
  }
  await t.as(u.owner, `insert into public.expenses (kitchen_id, expense_date, category_id, kind, amount_paise, receipt_path)
                       values ($1, '2026-11-01', $2, 'running', 50000, $3)`, [w.k1, cat, kept]);
  const listed = (await t.asService('select * from public.media_expired(1000)')).filter((r) => r.bucket_id === 'receipts').map((r) => r.name);
  assert.deepEqual(listed, [orphanOld]);
});

test('heatmap: meals and skips by weekday x lunch/dinner, owner only', async () => {
  for (const c of [w.cust.A, w.cust.B]) {
    const o = await w.order(c, '2026-12-01', 'lunch');                       // Tuesday
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  }
  const wed = await w.order(w.cust.A, '2026-12-02', 'lunch');
  await t.call(u.custA, 'public.customer_skip_meal($1)', [wed.id]);
  const rows = await t.as(u.owner, `select * from public.owner_weekday_counts($1, '2026-12-01', '2026-12-07')`, [w.k1]);
  assert.equal(rows.length, 14);
  const cell = (wd, slot) => rows.find((r) => r.weekday === wd && r.meal_slot === slot);
  assert.deepEqual(cell(2, 'lunch'), { weekday: 2, meal_slot: 'lunch', delivered: 2, skipped: 0, days: 1 });
  assert.deepEqual(cell(3, 'lunch'), { weekday: 3, meal_slot: 'lunch', delivered: 0, skipped: 1, days: 1 });
  assert.equal(rows.reduce((s, r) => s + r.days, 0), 14);
  await rejects(t.as(u.custA, `select * from public.owner_weekday_counts($1, '2026-12-01', '2026-12-07')`, [w.k1]), 'NOT_ALLOWED');
  await rejects(t.as(u.owner2, `select * from public.owner_weekday_counts($1, '2026-12-01', '2026-12-07')`, [w.k1]), 'NOT_ALLOWED');
  await rejects(t.as(u.owner, `select * from public.owner_weekday_counts($1, '2025-01-01', '2026-12-07')`, [w.k1]), 'INVALID_DATES');
});
