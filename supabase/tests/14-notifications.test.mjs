// Phase 4: inbox notifications raised by events, preferences, announcements, push queue.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const inbox = async (user, kind) =>
  t.as(user, `select kind, title, body, data, push_status from public.notifications where ($1::text is null or kind = $1) order by created_at`, [kind ?? null]);

test('assignment tells the delivery person once per meal; delivery tells the customer', async () => {
  const a = await w.order(w.cust.A, '2026-12-01', 'lunch');
  const b = await w.order(w.cust.B, '2026-12-01', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${a.id},${b.id}}`, w.staff.delivery]);
  const route = await inbox(u.delivery, 'route_ready');
  assert.equal(route.length, 1);
  assert.equal(route[0].title, 'Lunch route ready');
  await t.setNow(IST('2026-12-01', '13:20'));
  await t.call(u.delivery, 'public.staff_mark_delivered($1)', [a.id]);
  const mine = await inbox(u.custA, 'meal_delivered');
  assert.deepEqual(mine.map((n) => n.title), ['Lunch delivered']);
  assert.equal((await inbox(u.custB, 'meal_delivered')).length, 0, 'B not delivered yet, and never sees A\'s inbox');
});

test('customer moving after the route is planned alerts the delivery person', async () => {
  const b = await w.order(w.cust.B, '2026-12-01', 'lunch');
  await t.setNow(IST('2026-12-01', '12:00'));        // after the 11:00 extras cutoff, before 13:00 location cutoff
  await t.call(u.custB, 'public.customer_set_location($1, $2, $3)', [b.id, w.lab2, 'room 4']);
  const [n] = await inbox(u.delivery, 'location_changed');
  assert.equal(n.title, 'Anil moved');
  assert.match(n.body, /City Hospital > Lab 2 \(room 4\)/);
});

test('late skip alerts the owner and the assigned delivery person', async () => {
  const b2 = await w.order(w.cust.B, '2026-12-02', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${b2.id}}`, w.staff.delivery]);
  await t.setNow(IST('2026-12-02', '11:30'));
  await t.call(u.custB, 'public.customer_skip_meal($1)', [b2.id]);
  assert.equal((await inbox(u.owner, 'late_skip')).length, 1);
  assert.deepEqual((await inbox(u.delivery, 'late_skip')).map((n) => n.title), ['Skip Anil']);
});

test('day off: one message per customer (whole day), and "open again" when undone; nothing to staff', async () => {
  const cl = await t.call(u.owner, 'public.owner_add_closure($1, $2::date, null, $3)', [w.k1, '2026-12-04', 'Diwali']);
  const b = await inbox(u.custB, 'closure');
  assert.equal(b.length, 1, 'B has lunch + dinner but gets one message');
  assert.match(b[0].body, /No lunch or dinner on Fri 04 Dec \(Diwali\)/);
  assert.equal((await inbox(u.custA, 'closure')).length, 1);
  await t.call(u.owner, 'public.owner_cancel_closure($1)', [cl]);
  assert.equal((await inbox(u.custB, 'closure_cancelled')).length, 2);   // lunch + dinner back on
  assert.equal((await inbox(u.delivery, 'closure')).length, 0);
});

test('payments: submitted -> owner; confirmed / rejected -> customer', async () => {
  const p1 = await t.call(u.custA, 'public.customer_submit_payment($1, 120000, $2, $3, $4, null)', [w.k1, 'UTRNOTIF0001', '2026-12-02', 'notif-pay-01']);
  const p2 = await t.call(u.custA, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)', [w.k1, 'UTRNOTIF0002', '2026-12-02', 'notif-pay-02']);
  const owner = await inbox(u.owner, 'payment_submitted');
  assert.deepEqual(owner.map((n) => n.title).sort(), ['Priya paid ₹1200', 'Priya paid ₹50']);
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [p1.payment_id]);
  await t.call(u.owner, 'public.owner_reject_payment($1, $2)', [p2.payment_id, 'Not in bank statement']);
  assert.deepEqual((await inbox(u.custA, 'payment_confirmed')).map((n) => n.body), ['₹1200 received. Thank you!']);
  assert.match((await inbox(u.custA, 'payment_rejected'))[0].body, /Not in bank statement/);
  await t.call(u.owner, 'public.owner_record_payment($1, 3000, $2, null, $3, null, $4)', [w.cust.B, 'cash', '2026-12-02', 'notif-cash-01']);
  assert.equal((await inbox(u.custB, 'payment_confirmed')).length, 1, 'cash recorded by owner also confirms to customer');
});

test('bill ready reaches only that customer', async () => {
  await t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, null)', [w.cust.A, '2026-12-01', '2026-12-02']);
  assert.equal((await inbox(u.custA, 'bill_ready')).length, 1);
  assert.equal((await inbox(u.custB, 'bill_ready')).length, 0);
});

test('scheduled jobs: location reminder in the 30-min window (once), owner summary after cutoff (once)', async () => {
  await t.setNow(IST('2026-12-03', '12:40'));        // lunch location cutoff 13:00
  await t.sql('select app.run_notification_jobs()');
  await t.sql('select app.run_notification_jobs()');
  const rem = await inbox(u.custB, 'location_reminder');
  assert.equal(rem.length, 1);
  assert.match(rem[0].body, /before 1:00 PM/);
  assert.equal((await inbox(u.custA, 'location_reminder')).length, 0, 'A has a usual place set');
  const sum = await inbox(u.owner, 'daily_summary');
  assert.equal(sum.length, 1);
  assert.match(sum[0].body, /^2 tiffins \(1 veg, 1 non-veg\)\.$/);
});

test('preferences: muted kinds stay in the inbox but are not pushed; days off cannot be muted', async () => {
  await t.call(u.custA, 'public.set_notification_prefs($1::text[])', ['{meal_delivered}']);
  const a = await w.order(w.cust.A, '2026-12-03', 'lunch');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [a.id, 'delivered']);
  const n = (await inbox(u.custA, 'meal_delivered')).at(-1);
  assert.equal(n.push_status, 'skipped');
  await rejects(t.call(u.custA, 'public.set_notification_prefs($1::text[])', ['{closure}']), 'INVALID_SETTING');
  await rejects(t.call(u.custA, 'public.set_notification_prefs($1::text[])', ['{bogus}']), 'INVALID_SETTING');
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.notification_prefs'))[0].n, 0);
});

test('mark as read: own only', async () => {
  const before = (await t.as(u.custB, 'select count(*)::int n from public.notifications where read_at is null'))[0].n;
  assert.ok(before > 0);
  const ids = (await t.sql('select array_agg(id) as ids from public.notifications where user_id = $1', [u.custB.id]))[0].ids;
  assert.equal(await t.call(u.custA, 'public.mark_notifications_read($1::uuid[])', [`{${ids.join(',')}}`]), 0);
  assert.equal(await t.call(u.custB, 'public.mark_notifications_read(null)'), before);
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.notifications where read_at is null'))[0].n, 0);
  await rejects(t.as(u.custB, 'update public.notifications set read_at = null'), 'permission denied');
});

test('announcement: owner only, reaches linked customers (+ staff if chosen), rate-limited', async () => {
  const n1 = await t.call(u.owner, 'public.owner_send_announcement($1, $2, $3, false)', [w.k1, 'Diwali special', 'Sweets with lunch on Friday!']);
  assert.equal(n1, 2);                               // Priya + Anil (kitchen 1 only)
  const n2 = await t.call(u.owner, 'public.owner_send_announcement($1, $2, $3, true)', [w.k1, 'Team', 'Meeting at 9']);
  assert.equal(n2, 2 + 3);                           // + Ravi, Sunil, Meena
  assert.equal((await inbox(u.custC, 'announcement')).length, 0);
  for (const user of [u.custA, u.delivery, u.owner2]) {
    await rejects(t.call(user, 'public.owner_send_announcement($1, $2, $3, false)', [w.k1, 'x', 'y']), 'NOT_ALLOWED');
  }
});

test('push queue: only the service role can claim; tokens joined; results applied; bad tokens removed', async () => {
  await rejects(t.as(u.owner, 'select * from public.push_claim(10)'), 'permission denied');
  await rejects(t.as(u.custA, `select public.push_complete('[]'::jsonb)`), 'permission denied');
  const tokB = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
  await t.call(u.custB, 'public.register_device($1, $2, null, $3)', ['android', tokB, 'Anil phone']);
  const claimed = await t.asService('select * from public.push_claim(500)');
  const forB = claimed.filter((r) => r.tokens.includes(tokB));
  assert.ok(forB.length > 0, 'B has pending notifications with his token');
  assert.ok(claimed.every((r) => r.data.kind && r.data.notification_id));
  assert.equal((await t.asService('select * from public.push_claim(500)')).length, 0, 'claimed rows are not handed out twice');

  const results = claimed.map((r) => ({
    id: r.notification_id,
    status: r.tokens.length === 0 ? 'no_device' : 'retry',
    invalid_tokens: r.tokens.length ? [tokB] : [],
  }));
  await t.asService('select public.push_complete($1::jsonb)', [JSON.stringify(results)]);
  assert.equal((await t.sql('select count(*)::int n from public.devices where expo_push_token = $1', [tokB]))[0].n, 0);
  const statuses = await t.sql(`select push_status, count(*)::int n from public.notifications where id = any($1::uuid[]) group by 1`,
    [`{${claimed.map((r) => r.notification_id).join(',')}}`]);
  assert.ok(statuses.every((s) => ['pending', 'skipped'].includes(s.push_status)));
});

test('housekeeping: stuck sends retried, inbox kept 60 days', async () => {
  await t.sql(`update public.notifications set push_status = 'sending', push_updated_at = now() - interval '1 hour' where id = (select id from public.notifications limit 1)`);
  await t.setNow('2027-02-10T03:30:00Z');
  await t.sql('select app.run_notification_jobs()');
  assert.equal((await t.sql(`select count(*)::int n from public.notifications`))[0].n, 0);
});
