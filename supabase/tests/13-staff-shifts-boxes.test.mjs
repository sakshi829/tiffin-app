// Phase 3b: shifts and box pickup lists.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, aL, bL;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  aL = await w.order(w.cust.A, '2026-12-01', 'lunch');
  bL = await w.order(w.cust.B, '2026-12-01', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${aL.id}}`, w.staff.delivery]);
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${bL.id}}`, w.staff.delivery2]);
  await t.setNow(IST('2026-12-01', '13:20'));
  await t.call(u.delivery, 'public.staff_mark_delivered($1)', [aL.id]);
  await t.call(u.delivery2, 'public.staff_mark_delivered($1)', [bL.id]);
});
after(async () => { await t.close(); });

test('check in / out: idempotent, one open shift, own rows only, owner sees all', async () => {
  const a = await t.call(u.delivery, 'public.staff_check_in($1)', [w.k1]);
  const again = await t.call(u.delivery, 'public.staff_check_in($1)', [w.k1]);
  assert.equal(a.shift_id, again.shift_id);
  await t.setNow(IST('2026-12-01', '15:00'));
  const out = await t.call(u.delivery, 'public.staff_check_out($1)', [w.k1]);
  assert.equal(out.shift_id, a.shift_id);
  assert.equal((await t.call(u.delivery, 'public.staff_check_out($1)', [w.k1])).shift_id, null);
  await t.call(u.kitchen, 'public.staff_check_in($1)', [w.k1]);

  assert.equal((await t.as(u.delivery, 'select count(*)::int n from public.staff_shifts'))[0].n, 1);
  assert.equal((await t.as(u.owner, 'select count(*)::int n from public.staff_shifts'))[0].n, 2);
  for (const user of [u.custA, u.stranger, u.owner2]) {
    assert.equal((await t.as(user, 'select count(*)::int n from public.staff_shifts'))[0].n, 0);
  }
  for (const user of [u.custA, u.owner, u.stranger]) {
    await rejects(t.call(user, 'public.staff_check_in($1)', [w.k1]), 'NOT_ALLOWED');
  }
  await rejects(t.as(u.delivery, 'update public.staff_shifts set started_at = now()'), 'permission denied');
  await rejects(t.as(u.owner, 'delete from public.staff_shifts'), 'permission denied');
});

test('deactivating staff closes their open shift and blocks check-in', async () => {
  await t.call(u.delivery2, 'public.staff_check_in($1)', [w.k1]);
  await t.call(u.owner, 'public.owner_set_staff($1, $2, false, false)', [w.staff.delivery2, 'delivery']);
  const [{ open }] = await t.sql('select count(*)::int open from public.staff_shifts where staff_id = $1 and ended_at is null', [w.staff.delivery2]);
  assert.equal(open, 0);
  await rejects(t.call(u.delivery2, 'public.staff_check_in($1)', [w.k1]), 'NOT_ALLOWED');
  await t.call(u.owner, 'public.owner_set_staff($1, $2, false, true)', [w.staff.delivery2, 'delivery']);
});

test('box pickups: only my deliveries, shows where it was kept, disappears once collected', async () => {
  await t.call(u.custA, 'public.customer_mark_box_kept($1, $2, null)', [aL.id, 'Nurse station, Ward 5']);
  const mine = await t.as(u.delivery, 'select * from public.staff_box_pickups($1)', [w.k1]);
  assert.deepEqual(mine.map((r) => [r.customer_name, r.kept_at]), [['Priya', 'Nurse station, Ward 5']]);
  const other = await t.as(u.delivery2, 'select * from public.staff_box_pickups($1)', [w.k1]);
  assert.deepEqual(other.map((r) => r.customer_name), ['Anil']);
  await t.call(u.delivery, 'public.staff_box_collected($1, null, $2)', [aL.id, 'pickup-0001']);
  assert.equal((await t.as(u.delivery, 'select * from public.staff_box_pickups($1)', [w.k1])).length, 0);
  await rejects(t.as(u.kitchen, 'select * from public.staff_box_pickups($1)', [w.k1]), 'NOT_ALLOWED');
  await rejects(t.as(u.custA, 'select * from public.staff_box_pickups($1)', [w.k1]), 'NOT_ALLOWED');
});

test('owner: boxes not back yet, and can mark one collected (idempotent)', async () => {
  const out = await t.as(u.owner, 'select * from public.owner_boxes_out($1)', [w.k1]);
  assert.deepEqual(out.map((r) => r.customer_name), ['Anil']);   // Priya's box was collected
  const m1 = await t.call(u.owner, 'public.owner_box_collected($1)', [bL.id]);
  const m2 = await t.call(u.owner, 'public.owner_box_collected($1)', [bL.id]);
  assert.equal(m1.movement_id, m2.movement_id);
  assert.equal((await t.as(u.owner, 'select * from public.owner_boxes_out($1)', [w.k1])).length, 0);
  const notDelivered = await w.order(w.cust.A, '2026-12-02', 'lunch');
  await rejects(t.call(u.owner, 'public.owner_box_collected($1)', [notDelivered.id]), 'ORDER_NOT_DELIVERED');
  for (const user of [u.custA, u.delivery, u.owner2]) {
    await rejects(t.as(user, 'select * from public.owner_boxes_out($1)', [w.k1]), 'NOT_ALLOWED');
    await rejects(t.call(user, 'public.owner_box_collected($1)', [bL.id]), 'NOT_ALLOWED');
  }
});
