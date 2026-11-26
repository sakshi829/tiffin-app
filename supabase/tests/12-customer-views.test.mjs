// Customer app read functions: own data only, server-computed cutoffs, priced extras.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  // A gets a special egg price
  await t.call(u.owner, 'public.owner_set_price_override($1, null, $2, 1200, $3, null)', [w.cust.A, w.items.egg, '2026-12-01']);
});
after(async () => { await t.close(); });

const myOrders = (user, from, to, kitchen = w.k1) =>
  t.as(user, 'select * from public.customer_my_orders($1, $2::date, $3::date)', [kitchen, from, to]);

test('customer_my_orders: only own meals, lunch before dinner, with server cutoffs', async () => {
  const a = await myOrders(u.custA, '2026-12-01', '2026-12-03');
  assert.equal(a.length, 3);
  const first = a[0];
  assert.equal(first.tiffin_type_name, 'Veg Standard');
  assert.equal(first.delivery_at.toISOString(), IST('2026-12-01', '13:30').replace('Z', '.000Z'));
  assert.equal(first.addon_cutoff_at.toISOString(), IST('2026-12-01', '11:00').replace('Z', '.000Z'));
  assert.equal(first.location_cutoff_at.toISOString(), IST('2026-12-01', '13:00').replace('Z', '.000Z'));
  const b = await myOrders(u.custB, '2026-12-01', '2026-12-01');
  assert.deepEqual(b.map((r) => r.meal_slot), ['lunch', 'dinner']);
  assert.deepEqual(b[1].addons.map((x) => [x.name, x.qty, x.requested_by_role]), [['Egg', 1, 'subscription']]);
});

test('customer_my_orders: date window is limited; strangers, staff and other kitchens get nothing', async () => {
  await rejects(myOrders(u.custA, '2026-12-01', '2027-03-01'), 'INVALID_DATES');
  await rejects(myOrders(u.custA, '2026-12-03', '2026-12-01'), 'INVALID_DATES');
  await rejects(myOrders(u.custA, '2027-02-01', '2027-02-02'), 'INVALID_DATES');
  for (const user of [u.stranger, u.delivery, u.kitchen, u.owner]) {
    await rejects(myOrders(user, '2026-12-01', '2026-12-02'), 'NOT_FOUND');
  }
  await rejects(myOrders(u.custA, '2026-12-01', '2026-12-02', w.k2), 'NOT_FOUND');
});

test('customer_my_orders shows location and where the box was kept', async () => {
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.call(u.custA, 'public.customer_set_location($1, $2, $3)', [o.id, w.ward5, 'bed 12']);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  await t.call(u.custA, 'public.customer_mark_box_kept($1, $2, null)', [o.id, 'Nurse station']);
  const [row] = await myOrders(u.custA, '2026-12-01', '2026-12-01');
  assert.equal(row.location_path, 'City Hospital > Ward 5');
  assert.equal(row.location_text, 'bed 12');
  assert.equal(row.status, 'delivered');
  assert.equal(row.box_kept_at, 'Nurse station');
});

test('customer_addon_menu: orderable, available, priced for THIS customer; nobody else can ask', async () => {
  const oA = await w.order(w.cust.A, '2026-12-02', 'lunch');
  const menu = await t.as(u.custA, 'select * from public.customer_addon_menu($1)', [oA.id]);
  assert.deepEqual(menu.map((m) => [m.name, Number(m.price_paise)]), [['Bhakri', 1000], ['Egg', 1200], ['Salad', 2000]]);
  assert.ok(!menu.some((m) => m.name === 'Roti' || m.name === 'Pickle'));   // not orderable / inactive
  await rejects(t.as(u.custB, 'select * from public.customer_addon_menu($1)', [oA.id]), 'NOT_FOUND');
  await rejects(t.as(u.delivery, 'select * from public.customer_addon_menu($1)', [oA.id]), 'NOT_FOUND');
  // and the price actually charged matches the menu
  const r = await t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [oA.id, w.items.egg]);
  assert.equal(r.unit_price_paise, 1200);
});

test('redeem_invite with expected kind: a code for the other app is refused and NOT used up', async () => {
  const staffCode = await t.call(u.owner, 'public.owner_create_staff_invite($1, $2, $3, 3)', [w.k1, 'delivery', 'Mohan']);
  const person = await t.createUser('mohan');
  assert.deepEqual(await t.call(person, 'public.redeem_invite($1, $2)', [staffCode, 'customer']), { ok: false, error: 'WRONG_APP' });
  assert.equal((await t.sql('select count(*)::int n from public.staff_members where user_id = $1', [person.id]))[0].n, 0);
  const ok = await t.call(person, 'public.redeem_invite($1, $2)', [staffCode, 'staff']);
  assert.equal(ok.ok, true);
  await rejects(t.call(person, 'public.redeem_invite($1, $2)', ['AAAAA-BBBBB', 'owner']), 'INVALID_REQUEST');
});

test('customer_update_food_notes: own row only, validated, visible to owner, never copied into the audit log', async () => {
  await t.call(u.custA, 'public.customer_update_food_notes($1, $2)', [w.k1, 'No onion, less spicy']);
  const [c] = await t.as(u.owner, 'select food_notes from public.customers where id = $1', [w.cust.A]);
  assert.equal(c.food_notes, 'No onion, less spicy');
  await rejects(t.call(u.custA, 'public.customer_update_food_notes($1, $2)', [w.k1, 'x'.repeat(501)]), 'TEXT_TOO_LONG');
  await rejects(t.call(u.stranger, 'public.customer_update_food_notes($1, $2)', [w.k1, 'hi']), 'NOT_FOUND');
  await rejects(t.call(u.custC, 'public.customer_update_food_notes($1, $2)', [w.k1, 'hi']), 'NOT_FOUND');
  // personal details stay out of the permanent audit log (so erasing a customer leaves no copy)
  const [{ n }] = await t.sql(`select count(*)::int n from public.audit_log where table_name = 'customers' and (coalesce(new_data, '{}') ? 'food_notes' or coalesce(old_data, '{}') ? 'food_notes')`);
  assert.equal(n, 0);
  const [{ notes }] = await t.sql('select food_notes as notes from public.customers where id = $1', [w.cust.B]);
  assert.equal(notes, null, "B's notes untouched");
});
