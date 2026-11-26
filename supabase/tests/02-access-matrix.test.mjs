// Who can READ what (PLAN.md 13.1). Blanket checks over EVERY table so a new
// table can never silently leak.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  // create money rows for BOTH customers so leaks would be visible
  const oA = await w.order(w.cust.A, '2026-12-01', 'lunch');
  const oB = await w.order(w.cust.B, '2026-12-01', 'lunch');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [oA.id, 'delivered']);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [oB.id, 'delivered']);
  await t.call(u.custA, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)', [w.k1, 'UTRA123456', '2026-12-01', 'idem-A-0001']);
  await t.call(u.custB, 'public.customer_submit_payment($1, 7000, $2, $3, $4, null)', [w.k1, 'UTRB123456', '2026-12-01', 'idem-B-0001']);
  await t.as(u.owner, `insert into public.expenses (kitchen_id, expense_date, category_id, kind, amount_paise)
                       select $1, '2026-12-01', id, 'running', 50000 from public.expense_categories where kitchen_id = $1 limit 1`, [w.k1]);
});
after(async () => { await t.close(); });

const allTables = async () => (await t.sql(`select tablename from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.tablename);
const count = async (user, table, where = 'true', params = [], opts) =>
  (await t.as(user, `select count(*)::int as n from public.${table} where ${where}`, params, opts))[0].n;

test('anon (not logged in) cannot read ANY table', async () => {
  for (const table of await allTables()) {
    await rejects(t.as(null, `select 1 from public.${table} limit 1`), 'permission denied');
  }
});

test('a logged-in stranger (no invite redeemed) sees ZERO rows in every table', async () => {
  for (const table of await allTables()) {
    assert.equal(await count(u.stranger, table), 0, `stranger can see ${table}`);
  }
});

test('owner WITHOUT MFA (aal1) sees nothing that needs owner rights', async () => {
  for (const table of ['orders', 'customers', 'ledger_entries', 'payments', 'expenses', 'audit_log', 'invites', 'item_prices']) {
    assert.equal(await count(u.owner, table, 'true', [], { aal: 'aal1' }), 0, `aal1 owner sees ${table}`);
  }
});

test('customer A sees only their own rows, never customer B', async () => {
  for (const table of ['orders', 'ledger_entries', 'payments', 'subscriptions', 'customer_saved_locations', 'box_movements', 'bills', 'customer_skips']) {
    assert.equal(await count(u.custA, table, 'customer_id = $1', [w.cust.B]), 0, `A sees B in ${table}`);
  }
  assert.equal(await count(u.custA, 'customers', 'id = $1', [w.cust.B]), 0);
  assert.equal(await count(u.custA, 'customers'), 1);
  assert.ok(await count(u.custA, 'orders') > 0);
  assert.equal(await count(u.custA, 'orders', 'customer_id <> $1', [w.cust.A]), 0);
  assert.equal(await count(u.custA, 'order_addons'), 0, 'A must not see B\'s egg add-ons');
  assert.equal(await count(u.custA, 'subscription_addons'), 0);
  assert.equal(await count(u.custA, 'ledger_entries', 'customer_id = $1', [w.cust.A]), 1);
});

test('customers never see staff, audit, expenses, invites, companies or other customers\' prices', async () => {
  for (const table of ['staff_members', 'audit_log', 'expenses', 'expense_categories', 'invites', 'companies', 'packing_instructions', 'boxes']) {
    assert.equal(await count(u.custA, table), 0, `customer sees ${table}`);
  }
});

test('customers CAN read the menu, prices, timings, closures and location picker', async () => {
  for (const table of ['items', 'item_prices', 'tiffin_types', 'tiffin_type_prices', 'meal_slots', 'places', 'location_nodes', 'business_settings']) {
    assert.ok(await count(u.custA, table) > 0, `customer cannot read ${table}`);
  }
});

test('staff see NO orders, customers, prices or money directly (only via staff_my_tasks)', async () => {
  for (const user of [u.delivery, u.kitchen]) {
    for (const table of ['orders', 'order_addons', 'customers', 'item_prices', 'tiffin_type_prices', 'ledger_entries', 'payments',
      'bills', 'expenses', 'audit_log', 'invites', 'subscriptions', 'customer_price_overrides', 'box_movements', 'companies']) {
      assert.equal(await count(user, table), 0, `${user.label} sees ${table}`);
    }
    assert.equal(await count(user, 'staff_members'), 1, 'staff see only their own staff row');
    assert.ok(await count(user, 'items') > 0);
    assert.ok(await count(user, 'location_nodes') > 0);
  }
});

test('kitchens are isolated: owner2 / customer C see nothing of kitchen 1', async () => {
  for (const table of await allTables()) {
    const hasKitchen = (await t.sql(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'kitchen_id'`, [table])).length;
    if (!hasKitchen) continue;
    assert.equal(await count(u.owner2, table, 'kitchen_id = $1', [w.k1]), 0, `owner2 sees kitchen1 ${table}`);
    assert.equal(await count(u.custC, table, 'kitchen_id = $1', [w.k1]), 0, `custC sees kitchen1 ${table}`);
  }
});

test('owner (with MFA) sees everything in their kitchen', async () => {
  assert.equal(await count(u.owner, 'orders', 'kitchen_id = $1', [w.k1]), 24);
  assert.equal(await count(u.owner, 'customers'), 2);
  assert.equal(await count(u.owner, 'payments'), 2);
  assert.ok(await count(u.owner, 'audit_log') > 0);
  assert.equal(await count(u.owner, 'orders', 'kitchen_id = $1', [w.k2]), 0);
});

test('deactivated staff lose all access immediately', async () => {
  await t.call(u.owner, 'public.owner_set_staff($1, $2, false, false)', [w.staff.delivery2, 'delivery']);
  assert.equal(await count(u.delivery2, 'items'), 0);
  await rejects(t.call(u.delivery2, 'public.staff_my_tasks($1, $2::date, null)', [w.k1, '2026-12-01']), 'NOT_ALLOWED');
});
