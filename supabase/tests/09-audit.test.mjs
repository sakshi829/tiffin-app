// Audit trail: who changed what, only changed columns stored, owner-only, immutable.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

test('price changes are recorded with the acting owner', async () => {
  await t.call(u.owner, 'public.owner_set_item_price($1, 1700, $2)', [w.items.egg, '2026-12-10']);
  const rows = await t.sql(`select actor_user_id, action from public.audit_log where table_name = 'item_prices' and new_data ->> 'price_paise' = '1700'`);
  assert.deepEqual(rows, [{ actor_user_id: u.owner.id, action: 'INSERT' }]);
});

test('updates store only the changed columns, and never the contact details of customers', async () => {
  await t.as(u.owner, `update public.customers set billing_mode = 'advance', phone = '9811111111' where id = $1`, [w.cust.A]);
  const rows = await t.sql(`select old_data, new_data from public.audit_log where table_name = 'customers' and action = 'UPDATE' and record_id = $1 and actor_user_id = $2`, [w.cust.A, u.owner.id]);
  assert.deepEqual(rows, [{ old_data: { billing_mode: 'postpaid' }, new_data: { billing_mode: 'advance' } }]);
});

test('order status corrections are audited; customer location updates are not (kept on the order)', async () => {
  const o = await w.order(w.cust.A, '2026-12-02', 'lunch');
  await t.call(u.custA, 'public.customer_set_location($1, null, $2)', [o.id, 'Lab 3']);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, $3)', [o.id, 'skipped', 'Phoned in sick']);
  const rows = await t.sql(`select new_data from public.audit_log where table_name = 'orders' and record_id = $1`, [o.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].new_data.status, 'skipped');
  assert.equal(rows[0].new_data.location_text, undefined);
});

test('only the owner can read the audit log', async () => {
  for (const user of [u.custA, u.delivery, u.kitchen, u.owner2, u.stranger]) {
    assert.equal((await t.as(user, 'select count(*)::int n from public.audit_log where kitchen_id = $1', [w.k1]))[0].n, 0);
  }
  assert.ok((await t.as(u.owner, 'select count(*)::int n from public.audit_log'))[0].n > 0);
});

test('staff permission changes are audited', async () => {
  await t.call(u.owner, 'public.owner_set_staff($1, $2, true, true)', [w.staff.delivery, 'delivery']);
  const rows = await t.sql(`select new_data from public.audit_log where table_name = 'staff_members' and action = 'UPDATE' and record_id = $1`, [w.staff.delivery]);
  assert.deepEqual(rows.map((r) => r.new_data), [{ can_see_phone: true }]);
});
