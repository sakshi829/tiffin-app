// Owner report functions used by the Owner app (Phase 2).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  const a1 = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.call(u.custA, 'public.customer_set_location($1, $2, null)', [a1.id, w.lab2]);
  await t.call(u.custA, 'public.customer_request_addon($1, $2, 2)', [a1.id, w.items.bhakri]);
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${a1.id}}`, w.staff.delivery]);
  await t.setNow(IST('2026-12-01', '13:15'));
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [a1.id, 'delivered']);
  await t.call(u.owner, 'public.owner_record_payment($1, 5000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', 'rep-pay-0001']);
  await t.call(u.custB, 'public.customer_submit_payment($1, 3000, $2, $3, $4, null)', [w.k1, 'UTRREP00001', '2026-12-01', 'rep-pay-0002']);
});
after(async () => { await t.close(); });

test('owner_day_orders returns every order of the day with names, extras, location and staff', async () => {
  const rows = await t.as(u.owner, 'select * from public.owner_day_orders($1, $2::date)', [w.k1, '2026-12-01']);
  assert.equal(rows.length, 3);   // A lunch, B lunch, B dinner
  const a = rows.find((r) => r.customer_name === 'Priya');
  assert.equal(a.status, 'delivered');
  assert.equal(a.location_path, 'City Hospital > Lab 2');
  assert.equal(a.assigned_staff_name, 'Ravi');
  assert.deepEqual(a.addons.map((x) => [x.name, x.qty, x.unit_price_paise]), [['Bhakri', 2, 1000]]);
  const bd = rows.find((r) => r.customer_name === 'Anil' && r.meal_slot === 'dinner');
  assert.deepEqual(bd.addons.map((x) => x.name), ['Egg']);
});

test('owner_customer_balances shows dues, last payment and pending UTRs', async () => {
  const rows = await t.as(u.owner, 'select * from public.owner_customer_balances($1)', [w.k1]);
  const a = rows.find((r) => r.full_name === 'Priya');
  const b = rows.find((r) => r.full_name === 'Anil');
  assert.equal(Number(a.balance_paise), 8000 + 2000 - 5000);
  assert.equal(a.last_payment_on.toISOString().slice(0, 10), '2026-12-01');
  assert.equal(a.linked, true);
  assert.equal(b.pending_payments, 1);
  assert.equal(Number(b.balance_paise), 0);
});

test('owner_customer_statement: opening + entries = closing', async () => {
  const s = await t.call(u.owner, 'public.owner_customer_statement($1, $2::date, $3::date)', [w.cust.A, '2026-12-01', '2026-12-31']);
  assert.equal(s.opening_paise, 0);
  assert.deepEqual(s.entries.map((e) => e.kind).sort(), ['addon', 'meal', 'payment']);
  assert.equal(s.closing_paise, 5000);
  await rejects(t.call(u.owner, 'public.owner_customer_statement($1, $2::date, $3::date)', [w.cust.A, '2026-12-31', '2026-12-01']), 'INVALID_DATES');
});

test('reports are owner-only (customers, staff, other kitchens, no-MFA owner)', async () => {
  for (const user of [u.custA, u.delivery, u.kitchen, u.owner2, u.stranger]) {
    await rejects(t.as(user, 'select * from public.owner_day_orders($1, $2::date)', [w.k1, '2026-12-01']), 'NOT_ALLOWED');
    await rejects(t.as(user, 'select * from public.owner_customer_balances($1)', [w.k1]), 'NOT_ALLOWED');
    await rejects(t.call(user, 'public.owner_customer_statement($1, $2::date, $3::date)', [w.cust.A, '2026-12-01', '2026-12-31']), 'NOT_ALLOWED');
  }
  await rejects(t.as(u.owner, 'select * from public.owner_customer_balances($1)', [w.k1], { aal: 'aal1' }), 'NOT_ALLOWED');
});
