// Order generation, days off, pause/stop, subscription changes, price changes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const ordersOf = async (cust, slot = 'lunch') =>
  t.sql(`select order_date::text as d, status, unit_price_paise::int as p from public.orders
         where customer_id = $1 and meal_slot = $2 order by order_date`, [cust, slot]);

test('subscriptions generate today .. today+7 and generation is idempotent', async () => {
  assert.equal((await ordersOf(w.cust.A)).length, 8);
  assert.equal(await t.call(u.owner, 'public.owner_generate_orders($1, $2::date, $3::date)', [w.k1, '2026-12-01', '2026-12-08']), 0);
});

test('days of week are respected (Mon/Wed/Fri only)', async () => {
  const [{ id: custD }] = await t.as(u.owner, `insert into public.customers (kitchen_id, full_name) values ($1, 'Deepa') returning id`, [w.k1]);
  await t.call(u.owner, `public.owner_save_subscription(null, $1, 'lunch', $2, '2026-12-01'::date, null, '{1,3,5}'::int[], null, null, null, null, null)`, [custD, w.types.veg]);
  assert.deepEqual((await ordersOf(custD)).map((o) => o.d), ['2026-12-02', '2026-12-04', '2026-12-07']);   // Wed, Fri, Mon
});

test('day off for one meal: lunch cancelled, dinner untouched, nobody charged; can be undone', async () => {
  const cl = await t.call(u.owner, 'public.owner_add_closure($1, $2::date, $3, $4)', [w.k1, '2026-12-03', 'lunch', 'Family function']);
  assert.equal((await w.order(w.cust.A, '2026-12-03', 'lunch')).status, 'cancelled_closure');
  assert.equal((await w.order(w.cust.B, '2026-12-03', 'dinner')).status, 'scheduled');
  const o = await w.order(w.cust.A, '2026-12-03', 'lunch');
  await rejects(t.call(u.custA, 'public.customer_skip_meal($1)', [o.id]), 'ORDER_NOT_ACTIVE');
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [o.id, w.items.egg]), 'ORDER_NOT_ACTIVE');
  await t.call(u.owner, 'public.owner_cancel_closure($1)', [cl]);
  assert.equal((await w.order(w.cust.A, '2026-12-03', 'lunch')).status, 'scheduled');
});

test('whole-day closure cancels both meals; closures cannot be in the past', async () => {
  await t.call(u.owner, 'public.owner_add_closure($1, $2::date, null, null)', [w.k1, '2026-12-04']);
  assert.equal((await w.order(w.cust.B, '2026-12-04', 'lunch')).status, 'cancelled_closure');
  assert.equal((await w.order(w.cust.B, '2026-12-04', 'dinner')).status, 'cancelled_closure');
  await rejects(t.call(u.owner, 'public.owner_add_closure($1, $2::date, null, null)', [w.k1, '2026-11-30']), 'PAST_DATE');
});

test('future generation honours closures and leave ranges', async () => {
  await t.call(u.owner, 'public.owner_add_closure($1, $2::date, null, null)', [w.k1, '2026-12-10']);
  await t.call(u.custA, 'public.customer_skip_range($1, $2::date, $3::date, $4)', [w.k1, '2026-12-09', '2026-12-09', 'lunch']);
  await t.setNow(IST('2026-12-03', '09:00'));
  await t.sql('select app.generate_orders_all()');
  assert.equal((await w.order(w.cust.A, '2026-12-09', 'lunch')).status, 'skipped');
  assert.equal((await w.order(w.cust.A, '2026-12-10', 'lunch')).status, 'cancelled_closure');
  assert.equal((await w.order(w.cust.A, '2026-12-08', 'lunch')).status, 'scheduled');
  assert.equal(await w.order(w.cust.A, '2026-12-11', 'lunch'), undefined, 'beyond today + 7: not generated yet');
});

test('leave range skips future meals and can be cancelled', async () => {
  const r = await t.call(u.custB, 'public.customer_skip_range($1, $2::date, $3::date, null)', [w.k1, '2026-12-05', '2026-12-06']);
  assert.equal(r.orders_skipped, 4);   // 2 days x lunch+dinner
  const c = await t.call(u.custB, 'public.customer_cancel_skip_range($1)', [r.skip_id]);
  assert.equal(c.orders_restored, 4);
  await rejects(t.call(u.custB, 'public.customer_skip_range($1, $2::date, $3::date, null)', [w.k1, '2026-12-01', '2026-12-02']), 'INVALID_DATES');
});

test('pausing a customer removes only UNLOCKED future orders; re-activating restores them', async () => {
  await t.setNow(IST('2026-12-03', '11:30'));          // Dec 3 lunch is locked (cutoff 11:00)
  await t.as(u.owner, `update public.customers set status = 'paused' where id = $1`, [w.cust.A]);
  const paused = await ordersOf(w.cust.A);
  assert.ok(paused.some((o) => o.d === '2026-12-03'), 'locked order must remain');
  assert.ok(!paused.some((o) => o.d === '2026-12-05'), 'future unlocked orders removed');
  await t.as(u.owner, `update public.customers set status = 'active' where id = $1`, [w.cust.A]);
  assert.ok((await ordersOf(w.cust.A)).some((o) => o.d === '2026-12-05'), 're-activated orders regenerated');
});

test('price change applies from its date to unlocked orders only; locked and earlier orders keep their price', async () => {
  // now Dec 3 11:30: Dec 3 lunch locked
  await t.call(u.owner, 'public.owner_set_tiffin_price($1, 9000, $2)', [w.types.veg, '2026-12-03']);
  const byDate = Object.fromEntries((await ordersOf(w.cust.A)).map((o) => [o.d, o.p]));
  assert.equal(byDate['2026-12-03'], 8000, 'locked order keeps price');
  assert.equal(byDate['2026-12-05'], 9000);
  assert.equal(byDate['2026-12-08'], 9000);
});

test('customer-specific price and sum-of-items pricing', async () => {
  await t.call(u.owner, 'public.owner_set_price_override($1, $2, null, 7000, $3, null)', [w.cust.A, w.types.veg, '2026-12-06']);
  const byDate = Object.fromEntries((await ordersOf(w.cust.A)).map((o) => [o.d, o.p]));
  assert.equal(byDate['2026-12-05'], 9000);
  assert.equal(byDate['2026-12-06'], 7000);
  // a sum-of-items type: 4 roti x 800 = 3200
  const [{ id: rotiMeal }] = await t.as(u.owner, `insert into public.tiffin_types (kitchen_id, name, pricing_mode) values ($1, 'Roti meal', 'sum_of_items') returning id`, [w.k1]);
  await t.call(u.owner, 'public.owner_set_tiffin_items($1, $2::jsonb)', [rotiMeal, JSON.stringify([{ item_id: w.items.roti, qty: 4 }])]);
  assert.equal((await t.sql(`select app.tiffin_price($1, $2, $3, '2026-12-05') as p`, [w.k1, w.cust.B, rotiMeal]))[0].p, 3200);
});

test('subscription change: new tiffin type re-prices, end date removes later orders', async () => {
  await t.call(u.owner, `public.owner_save_subscription($1, $2, 'lunch', $3, '2026-12-01'::date, '2026-12-06'::date, null, null, null, 'active', null, null)`,
    [w.subs.BLunch, w.cust.B, w.types.veg]);
  const b = await ordersOf(w.cust.B);
  assert.equal(b.find((o) => o.d === '2026-12-05').p, 9000);          // now veg at the new price
  assert.ok(!b.some((o) => o.d > '2026-12-06' && o.status === 'scheduled'), 'orders after end date removed');
  await rejects(t.call(u.owner, `public.owner_save_subscription($1, $2, 'lunch', $3, '2026-12-01'::date, null, null, null, null, 'active', null, null)`,
    [w.subs.BLunch, w.cust.A, w.types.veg]), 'NOT_FOUND');              // cannot move a subscription to another customer
});

test('missing price is reported, never silently zero', async () => {
  const [{ id: noPrice }] = await t.as(u.owner, `insert into public.tiffin_types (kitchen_id, name) values ($1, 'Unpriced') returning id`, [w.k1]);
  await rejects(t.call(u.owner, `public.owner_save_subscription(null, $1, 'dinner', $2, '2026-12-05'::date, null, null, null, null, null, null, null)`,
    [w.cust.A, noPrice]), 'PRICE_NOT_SET');
});
