// Cutoffs (decisions 4-6) and late-skip charging (decision 8), server clock only.
// Lunch 13:30 IST -> add-on/skip cutoff 11:00, location cutoff 13:00.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const ledger = async (orderId) => t.sql(`select kind, amount_paise::int as amt from public.ledger_entries where order_id = $1 order by created_at`, [orderId]);

test('before the cutoff: extras and location changes are accepted', async () => {
  await t.setNow(IST('2026-12-01', '10:59'));
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  const r = await t.call(u.custA, 'public.customer_request_addon($1, $2, 2)', [o.id, w.items.egg]);
  assert.equal(r.status, 'accepted');
  const loc = await t.call(u.custA, 'public.customer_set_location($1, $2, $3)', [o.id, w.lab2, 'near reception']);
  assert.equal(loc.location_text, 'near reception');
});

test('after 11:00 extras are refused, but location can still change until 13:00', async () => {
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.setNow(IST('2026-12-01', '11:00'));
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [o.id, w.items.salad]), 'CUTOFF_PASSED');
  const addon = (await t.sql('select id from public.order_addons where order_id = $1', [o.id]))[0].id;
  await rejects(t.call(u.custA, 'public.customer_cancel_addon($1)', [addon]), 'CUTOFF_PASSED');
  await t.call(u.custA, 'public.customer_set_location($1, $2, null)', [o.id, w.ward5]);
  await t.setNow(IST('2026-12-01', '13:00'));
  await rejects(t.call(u.custA, 'public.customer_set_location($1, $2, null)', [o.id, w.lab2]), 'CUTOFF_PASSED');
});

test('skip before the cutoff is free and can be undone', async () => {
  await t.setNow(IST('2026-12-01', '15:00'));
  const o = await w.order(w.cust.A, '2026-12-02', 'lunch');
  const s = await t.call(u.custA, 'public.customer_skip_meal($1)', [o.id]);
  assert.deepEqual([s.status, s.charged], ['skipped', false]);
  const un = await t.call(u.custA, 'public.customer_unskip_meal($1)', [o.id]);
  assert.equal(un.status, 'scheduled');
  assert.deepEqual(await ledger(o.id), []);
});

test('late skips: first one in the month is free, the next is charged in full (tiffin + extras)', async () => {
  // A: Dec 2 late (free), Dec 3 late (charged 8000)
  await t.setNow(IST('2026-12-02', '11:30'));
  const d2 = await w.order(w.cust.A, '2026-12-02', 'lunch');
  const s2 = await t.call(u.custA, 'public.customer_skip_meal($1)', [d2.id]);
  assert.deepEqual([s2.status, s2.charged], ['skipped_late', false]);
  await rejects(t.call(u.custA, 'public.customer_unskip_meal($1)', [d2.id]), 'CANNOT_UNSKIP');

  await t.setNow(IST('2026-12-03', '11:30'));
  const d3 = await w.order(w.cust.A, '2026-12-03', 'lunch');
  const s3 = await t.call(u.custA, 'public.customer_skip_meal($1)', [d3.id]);
  assert.deepEqual([s3.status, s3.charged], ['skipped_late', true]);
  assert.deepEqual(await ledger(d3.id), [{ kind: 'late_skip', amt: 8000 }]);

  // B dinner (veg 8000 + 1 egg 1500): first free, second charged 9500
  await t.setNow(IST('2026-12-03', '18:30'));
  const b3 = await w.order(w.cust.B, '2026-12-03', 'dinner');
  assert.equal((await t.call(u.custB, 'public.customer_skip_meal($1)', [b3.id])).charged, false);
  await t.setNow(IST('2026-12-04', '18:30'));
  const b4 = await w.order(w.cust.B, '2026-12-04', 'dinner');
  assert.equal((await t.call(u.custB, 'public.customer_skip_meal($1)', [b4.id])).charged, true);
  assert.deepEqual(await ledger(b4.id), [{ kind: 'late_skip', amt: 9500 }]);
});

test('repeating a skip is idempotent (no double charge)', async () => {
  const d3 = await w.order(w.cust.A, '2026-12-03', 'lunch');
  await t.call(u.custA, 'public.customer_skip_meal($1)', [d3.id]);
  assert.equal((await ledger(d3.id)).length, 1);
});

test('after delivery time a meal can no longer be skipped', async () => {
  await t.setNow(IST('2026-12-04', '13:31'));
  const o = await w.order(w.cust.A, '2026-12-04', 'lunch');
  await rejects(t.call(u.custA, 'public.customer_skip_meal($1)', [o.id]), 'TOO_LATE');
});

test('owner moves lunch to 14:00 -> relative cutoffs move with it (11:30)', async () => {
  await t.as(u.owner, `update public.meal_slots set delivery_time = '14:00' where kitchen_id = $1 and meal_slot = 'lunch'`, [w.k1]);
  const o = await w.order(w.cust.A, '2026-12-05', 'lunch');
  await t.setNow(IST('2026-12-05', '11:15'));
  await t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [o.id, w.items.salad]);
  await t.setNow(IST('2026-12-05', '11:31'));
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [o.id, w.items.bhakri]), 'CUTOFF_PASSED');
});

test('one-day override (cutoff 10:00 on Dec 6) and fixed-time cutoff mode', async () => {
  await t.as(u.owner, `insert into public.slot_overrides (kitchen_id, override_date, meal_slot, addon_cutoff_time) values ($1, '2026-12-06', 'lunch', '10:00')`, [w.k1]);
  const o6 = await w.order(w.cust.A, '2026-12-06', 'lunch');
  await t.setNow(IST('2026-12-06', '10:30'));
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [o6.id, w.items.salad]), 'CUTOFF_PASSED');

  await t.as(u.owner, `update public.meal_slots set addon_cutoff_mode = 'fixed', addon_cutoff_time = '12:00' where kitchen_id = $1 and meal_slot = 'lunch'`, [w.k1]);
  const o7 = await w.order(w.cust.A, '2026-12-07', 'lunch');
  await t.setNow(IST('2026-12-07', '11:45'));
  await t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [o7.id, w.items.salad]);
});

test('a cutoff can never be configured after delivery time', async () => {
  await rejects(t.as(u.owner, `update public.meal_slots set addon_cutoff_mode = 'fixed', addon_cutoff_time = '15:00' where kitchen_id = $1 and meal_slot = 'lunch'`, [w.k1]), 'check constraint');
});

test('owner settings: 0 free late skips, 50% charge; per-customer override wins', async () => {
  await t.call(u.owner, `public.owner_update_settings($1, '{"free_late_skips_per_month": 0, "late_skip_charge_percent": 50}'::jsonb)`, [w.k1]);
  await t.as(u.owner, 'update public.customers set late_skip_free_override = 10 where id = $1', [w.cust.B]);
  await t.setNow(IST('2026-12-08', '12:30'));      // lunch cutoff is now fixed 12:00, delivery 14:00
  const a8 = await w.order(w.cust.A, '2026-12-08', 'lunch');
  const b8 = await w.order(w.cust.B, '2026-12-08', 'lunch');
  await t.call(u.custA, 'public.customer_skip_meal($1)', [a8.id]);
  await t.call(u.custB, 'public.customer_skip_meal($1)', [b8.id]);
  assert.deepEqual(await ledger(a8.id), [{ kind: 'late_skip', amt: 4000 }]);   // 50% of 8000
  assert.deepEqual(await ledger(b8.id), []);                                   // B exempt by override
});
