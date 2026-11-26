// Phase 5a engagement: scheduled announcements, auto-assignment, referrals, chat.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const count = async (user, sql, p = []) => (await t.as(user, sql, p))[0].n;

test('scheduled announcement: sent once at its time; cancel works; owner-only', async () => {
  await rejects(t.call(u.owner, 'public.owner_schedule_announcement($1, $2, $3, false, $4::timestamptz)', [w.k1, 'x', 'y', '2026-11-30T00:00:00Z']), 'INVALID_DATES');
  const id = await t.call(u.owner, 'public.owner_schedule_announcement($1, $2, $3, true, $4::timestamptz)',
    [w.k1, 'Holiday', 'Closed on Sunday', IST('2026-12-01', '18:00')]);
  const cancelled = await t.call(u.owner, 'public.owner_schedule_announcement($1, $2, $3, false, $4::timestamptz)',
    [w.k1, 'Oops', 'Never send', IST('2026-12-01', '18:00')]);
  await t.call(u.owner, 'public.owner_cancel_announcement($1)', [cancelled]);
  await t.sql('select app.run_engagement_jobs()');
  assert.equal(await count(u.custA, `select count(*)::int n from public.notifications where kind = 'announcement'`), 0);
  await t.setNow(IST('2026-12-01', '18:01'));
  await t.sql('select app.run_engagement_jobs()');
  await t.sql('select app.run_engagement_jobs()');
  assert.equal(await count(u.custA, `select count(*)::int n from public.notifications where kind = 'announcement'`), 1);
  assert.equal(await count(u.delivery, `select count(*)::int n from public.notifications where kind = 'announcement'`), 1);
  const [a] = await t.sql('select sent_count from public.announcements where id = $1', [id]);
  assert.equal(a.sent_count, 5);
  await rejects(t.call(u.owner, 'public.owner_cancel_announcement($1)', [id]), 'INVALID_STATUS');
  assert.equal(await count(u.custA, 'select count(*)::int n from public.announcements'), 0);
  await rejects(t.call(u.custA, 'public.owner_schedule_announcement($1, $2, $3, false, $4::timestamptz)', [w.k1, 'x', 'y', IST('2026-12-05', '09:00')]), 'NOT_ALLOWED');
});

test('auto-assignment by place: fills only unassigned meals, never overrides the owner', async () => {
  await t.setNow(IST('2026-12-02', '08:00'));
  await rejects(t.call(u.owner, 'public.owner_set_place_staff($1, $2)', [w.place, w.staff.kitchen]), 'INVALID_STAFF');
  await t.call(u.owner, 'public.owner_set_place_staff($1, $2)', [w.place, w.staff.delivery]);
  const b = await w.order(w.cust.B, '2026-12-02', 'lunch');
  await t.call(u.custB, 'public.customer_set_location($1, $2, null)', [b.id, w.lab2]);
  const a = await w.order(w.cust.A, '2026-12-02', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${a.id}}`, w.staff.delivery2]);
  await t.sql('select app.run_engagement_jobs()');
  assert.equal((await w.order(w.cust.B, '2026-12-02', 'lunch')).assigned_staff_id, w.staff.delivery);
  assert.equal((await w.order(w.cust.A, '2026-12-02', 'lunch')).assigned_staff_id, w.staff.delivery2, 'manual choice kept');
  assert.ok(await count(u.delivery, `select count(*)::int n from public.notifications where kind = 'route_ready'`) >= 1);
  assert.equal(await count(u.custA, 'select count(*)::int n from public.place_delivery_staff'), 0);
  await t.call(u.owner, 'public.owner_set_place_staff($1, null)', [w.place]);
  assert.equal((await t.sql('select count(*)::int n from public.place_delivery_staff'))[0].n, 0);
});

test('refer a friend: owner approves -> new (unlinked) customer; private to the referrer', async () => {
  await rejects(t.call(u.custA, 'public.customer_refer_friend($1, $2, $3, null)', [w.k1, 'Rina', 'call me']), 'INVALID_REQUEST');
  const id = await t.call(u.custA, 'public.customer_refer_friend($1, $2, $3, $4)', [w.k1, 'Rina', '9811122233', 'Ward 7 nurse']);
  assert.equal(await count(u.owner, `select count(*)::int n from public.notifications where kind = 'referral_request'`), 1);
  assert.equal(await count(u.custB, 'select count(*)::int n from public.referral_requests'), 0);
  await rejects(t.call(u.custA, 'public.owner_decide_referral($1, true)', [id]), 'NOT_ALLOWED');
  const newCustomer = await t.call(u.owner, 'public.owner_decide_referral($1, true)', [id]);
  const [c] = await t.sql('select full_name, phone, user_id from public.customers where id = $1', [newCustomer]);
  assert.deepEqual(c, { full_name: 'Rina', phone: '9811122233', user_id: null });
  await rejects(t.call(u.owner, 'public.owner_decide_referral($1, false)', [id]), 'INVALID_STATUS');
  assert.equal(await count(u.custA, `select count(*)::int n from public.notifications where kind = 'referral_decision'`), 1);
  await rejects(t.call(u.stranger, 'public.customer_refer_friend($1, $2, $3, null)', [w.k1, 'X', '9811122233']), 'NOT_FOUND');
});

test('chat: customer <-> owner only, notifications both ways, read receipts, private threads', async () => {
  await t.call(u.custA, 'public.customer_send_message($1, $2)', [w.k1, 'Less oil today please']);
  assert.equal(await count(u.owner, `select count(*)::int n from public.notifications where kind = 'chat_message'`), 1);
  const [thread] = await t.as(u.owner, 'select * from public.owner_chat_threads($1)', [w.k1]);
  assert.deepEqual([thread.full_name, thread.last_body, thread.unread], ['Priya', 'Less oil today please', 1]);
  await t.call(u.owner, 'public.owner_send_message($1, $2)', [w.cust.A, 'Sure, noted!']);
  assert.equal(await count(u.custA, `select count(*)::int n from public.notifications where kind = 'chat_message'`), 1);
  assert.equal(await t.call(u.owner, 'public.chat_mark_read($1)', [w.cust.A]), 1);
  assert.equal(await t.call(u.custA, 'public.chat_mark_read($1)', [w.cust.A]), 1);
  assert.equal(await count(u.custA, 'select count(*)::int n from public.chat_messages'), 2);
  for (const user of [u.custB, u.delivery, u.kitchen, u.owner2, u.stranger]) {
    assert.equal(await count(user, 'select count(*)::int n from public.chat_messages'), 0);
  }
  await rejects(t.call(u.custB, 'public.chat_mark_read($1)', [w.cust.A]), 'NOT_FOUND');
  await rejects(t.call(u.delivery, 'public.owner_send_message($1, $2)', [w.cust.A, 'hi']), 'NOT_ALLOWED');
  await rejects(t.call(u.custA, 'public.customer_send_message($1, $2)', [w.k1, '   ']), 'INVALID_REQUEST');
  await rejects(t.as(u.owner, 'delete from public.chat_messages'), 'permission denied');
  await rejects(t.sql('delete from public.chat_messages'), 'IMMUTABLE');
});
