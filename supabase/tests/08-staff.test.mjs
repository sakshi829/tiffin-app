// Staff app: role-based task lists, phone visibility only when enabled,
// no prices, only assigned deliveries, today only, box collection.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, aL, bL, bD, aL2;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  aL = await w.order(w.cust.A, '2026-12-01', 'lunch');
  bL = await w.order(w.cust.B, '2026-12-01', 'lunch');
  bD = await w.order(w.cust.B, '2026-12-01', 'dinner');
  aL2 = await w.order(w.cust.A, '2026-12-02', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${aL.id},${bL.id},${aL2.id}}`, w.staff.delivery]);
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${bD.id}}`, w.staff.delivery2]);
});
after(async () => { await t.close(); });

const tasks = (user, date = '2026-12-01', slot = null) =>
  t.as(user, 'select * from public.staff_my_tasks($1, $2::date, $3)', [w.k1, date, slot]);

test('delivery staff see only THEIR deliveries, with directions, no phone, no prices', async () => {
  const rows = await tasks(u.delivery);
  assert.deepEqual(rows.map((r) => [r.task, r.customer_name, r.meal_slot]).sort(), [['deliver', 'Anil', 'lunch'], ['deliver', 'Priya', 'lunch']]);
  const priya = rows.find((r) => r.customer_name === 'Priya');
  assert.equal(priya.customer_phone, null);
  assert.equal(priya.food_notes, 'less spicy');
  assert.equal(priya.location_path, 'City Hospital > Ward 5');
  assert.equal(priya.location_directions, '3rd floor, lift B, nurse station');
  for (const key of Object.keys(priya)) assert.doesNotMatch(key, /price|amount|balance/);
});

test('phone numbers appear only after the owner enables them (step-up), and only for today', async () => {
  await t.call(u.owner, 'public.owner_set_staff($1, $2, true, true)', [w.staff.delivery, 'delivery']);
  assert.equal((await tasks(u.delivery)).find((r) => r.customer_name === 'Priya').customer_phone, '9800000001');
  assert.equal((await tasks(u.delivery, '2026-12-02'))[0].customer_phone, null);
});

test('kitchen staff get the packing list for everyone, never phone numbers or deliveries', async () => {
  const rows = await tasks(u.kitchen);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.task === 'pack' && r.customer_phone === null));
  const dinner = rows.find((r) => r.meal_slot === 'dinner');
  assert.deepEqual(dinner.addons, [{ name: 'Egg', qty: 1 }]);
});

test('task dates are limited to yesterday..tomorrow', async () => {
  await rejects(tasks(u.delivery, '2026-12-05'), 'INVALID_DATES');
  await rejects(tasks(u.delivery, '2026-11-01'), 'INVALID_DATES');
});

test('staff can only complete their own deliveries, and only today', async () => {
  await rejects(t.call(u.delivery, 'public.staff_mark_delivered($1)', [bD.id]), 'NOT_FOUND');        // assigned to delivery2
  await rejects(t.call(u.kitchen, 'public.staff_mark_delivered($1)', [aL.id]), 'NOT_FOUND');         // kitchen role
  await rejects(t.call(u.delivery, 'public.staff_mark_delivered($1)', [aL2.id]), 'NOT_TODAY');       // tomorrow
  await t.setNow(IST('2026-12-01', '13:25'));
  assert.equal((await t.call(u.delivery, 'public.staff_mark_delivered($1)', [aL.id])).status, 'delivered');
  await rejects(t.call(u.delivery, 'public.staff_mark_not_delivered($1, $2)', [bL.id, '  ']), 'REASON_REQUIRED');
  assert.equal((await t.call(u.delivery, 'public.staff_mark_not_delivered($1, $2)', [bL.id, 'Not at desk, phone off'])).status, 'not_delivered');
  assert.equal(Number(await t.call(u.custB, 'public.my_balance($1)', [w.k1])), 0, 'not delivered = not charged');
});

test('only delivery-role staff can be assigned', async () => {
  await rejects(t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${aL2.id}}`, w.staff.kitchen]), 'INVALID_STAFF');
});

test('box flow: customer says where it is kept, staff scans it back (idempotent)', async () => {
  await t.as(u.owner, `insert into public.boxes (kitchen_id, code) values ($1, 'AK-017')`, [w.k1]);
  await t.call(u.custA, 'public.customer_mark_box_kept($1, $2, $3)', [aL.id, 'Nurse station, Ward 5', 'box-kept-0001']);
  await rejects(t.call(u.custB, 'public.customer_mark_box_kept($1, $2, null)', [bL.id, 'desk']), 'ORDER_NOT_DELIVERED');
  const m1 = await t.call(u.delivery, 'public.staff_box_collected($1, $2, $3)', [aL.id, 'ak-017', 'box-coll-0001']);
  const m2 = await t.call(u.delivery, 'public.staff_box_collected($1, $2, $3)', [aL.id, 'ak-017', 'box-coll-0001']);
  assert.equal(m1.movement_id, m2.movement_id);
  await rejects(t.call(u.delivery, 'public.staff_box_collected($1, $2, null)', [aL.id, 'AK-999']), 'UNKNOWN_BOX');
  await rejects(t.call(u.delivery2, 'public.staff_box_collected($1, null, null)', [aL.id]), 'NOT_FOUND');
  const kinds = (await t.as(u.custA, 'select kind from public.box_movements order by created_at')).map((r) => r.kind);
  assert.deepEqual(kinds.sort(), ['collected', 'kept_at']);
});
