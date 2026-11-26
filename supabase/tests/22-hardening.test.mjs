// Phase 7 hardening: every finding of the pre-launch security review is reproduced
// here exactly as the reviewer attacked it, and must now fail (migration 1900).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

const STALE = { mfaAgoSec: 3600 };   // owner signed in with MFA, but no authenticator code for an hour

async function fresh() {
  const w = await buildWorld();
  const { t, u } = w;
  const fees = (cust) => t.sql(`select amount_paise::int as amt from public.ledger_entries where customer_id = $1 and kind = 'late_fee' order by created_at`, [cust]);
  const decisions = (cust) => t.sql(`select outcome, amount_paise::int as amt from public.bill_late_fees where customer_id = $1 order by created_at`, [cust]);
  const deliver = async (cust, date, slot = 'lunch') => {
    const o = await w.order(cust, date, slot);
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
    return o;
  };
  const fee = (json) => t.call(u.owner, `public.owner_update_settings($1, $2::jsonb)`, [w.k1, JSON.stringify(json)]);
  const bill = (cust, from, to, dueDays) =>
    t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, $4)', [cust, from, to, dueDays]);
  const jobs = () => t.sql('select app.run_billing_jobs()');
  let k = 0;
  const pay = async (user, amount, paidOn, utr) => (await t.call(user, 'public.customer_submit_payment($1, $2, $3, $4, $5, null)',
    [w.k1, amount, utr ?? `UTR${100000 + (++k)}`, paidOn, `key-${Date.now()}-${++k}`])).payment_id;
  return { w, t, u, fees, decisions, deliver, fee, bill, jobs, pay };
}

// ------------------------------------------------------------------ 1. late fees (HIGH)
test('late fee: a bill paid on time never gets a fee, even after new meals are charged', async () => {
  const { w, t, u, fees, decisions, deliver, fee, bill, jobs, pay } = await fresh();
  await fee({ late_fee_enabled: true, late_fee_type: 'flat', late_fee_value: 5000 });
  await deliver(w.cust.A, '2026-12-01');
  await t.setNow(IST('2026-12-02', '10:00'));
  await bill(w.cust.A, '2026-12-01', '2026-12-01', 1);                       // ₹80, due 2 Dec
  const p = await pay(u.custA, 8000, '2026-12-02');
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [p]);           // paid on time
  await t.setNow(IST('2026-12-04', '10:00'));
  await jobs();
  await deliver(w.cust.A, '2026-12-04');                                    // a new, normal charge
  for (const d of ['2026-12-05', '2026-12-06', '2026-12-20']) { await t.setNow(IST(d, '10:00')); await jobs(); }
  assert.deepEqual(await fees(w.cust.A), []);
  assert.deepEqual(await decisions(w.cust.A), [{ outcome: 'nothing_due', amt: 0 }]);   // decided once, for good
  await rejects(t.sql('delete from public.bill_late_fees'), 'IMMUTABLE');
});

test('late fee: waits while a payment made by the due date awaits the owner; then decided fairly', async () => {
  const { w, t, u, fees, decisions, deliver, fee, bill, jobs, pay } = await fresh();
  await fee({ late_fee_enabled: true, late_fee_type: 'flat', late_fee_value: 5000 });
  await deliver(w.cust.A, '2026-12-01');
  await deliver(w.cust.B, '2026-12-01');
  await t.setNow(IST('2026-12-02', '10:00'));
  await bill(w.cust.A, '2026-12-01', '2026-12-01', 2);                       // due 3 Dec
  await bill(w.cust.B, '2026-12-01', '2026-12-01', 2);
  await t.setNow(IST('2026-12-03', '20:00'));                              // both pay late evening on the due date
  const pa = await pay(u.custA, 8000, '2026-12-03');
  const pb = await pay(u.custB, 12000, '2026-12-03');
  await t.setNow(IST('2026-12-04', '10:00'));
  await jobs();                                                             // owner hasn't looked yet
  assert.deepEqual([...await fees(w.cust.A), ...await fees(w.cust.B)], []);
  assert.deepEqual([...await decisions(w.cust.A), ...await decisions(w.cust.B)], []);
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [pa]);         // A's UTR was real
  await t.call(u.owner, 'public.owner_reject_payment($1, $2)', [pb, 'No such UTR']);   // B's was not
  await t.setNow(IST('2026-12-05', '10:00'));
  await jobs();
  assert.deepEqual(await decisions(w.cust.A), [{ outcome: 'nothing_due', amt: 0 }]);
  assert.deepEqual(await fees(w.cust.B), [{ amt: 5000 }]);
});

test('late fee: charged only on the bill\'s own charges, never on older debt or earlier fees', async () => {
  const { w, t, fees, deliver, fee, bill, jobs } = await fresh();
  await fee({ late_fee_enabled: true, late_fee_type: 'percent', late_fee_value: 10 });
  await deliver(w.cust.A, '2026-12-01');
  await t.setNow(IST('2026-12-02', '10:00'));
  await bill(w.cust.A, '2026-12-01', '2026-12-01', 0);                       // ₹80, due 1 Dec
  await t.setNow(IST('2026-12-03', '10:00'));
  await jobs();
  assert.deepEqual(await fees(w.cust.A), [{ amt: 800 }]);                  // 10 % of ₹80
  await deliver(w.cust.A, '2026-12-03');
  await t.setNow(IST('2026-12-04', '10:00'));
  const b2 = await bill(w.cust.A, '2026-12-02', '2026-12-03', 0);           // closing = 80 + 8 + 80 = ₹168
  assert.equal((await t.sql('select closing_balance_paise::int c from public.bills where id = $1', [b2]))[0].c, 16800);
  await t.setNow(IST('2026-12-05', '10:00'));
  await jobs();
  assert.deepEqual(await fees(w.cust.A), [{ amt: 800 }, { amt: 800 }]);    // not 1,680
});

test('late fee: a custom % is capped at 100 % and never more than what is unpaid; setting it needs step-up', async () => {
  const { w, t, u, fees, deliver, fee, bill, jobs } = await fresh();
  await fee({ late_fee_enabled: true, late_fee_type: 'percent', late_fee_value: 10 });
  await rejects(t.as(u.owner, `update public.customers set late_fee_mode = 'custom', late_fee_custom_value = 1000000 where id = $1`,
    [w.cust.A], STALE), 'STEP_UP_REQUIRED');
  await t.as(u.owner, `update public.customers set late_fee_mode = 'custom', late_fee_custom_value = 1000000 where id = $1`, [w.cust.A]);
  await deliver(w.cust.A, '2026-12-01');
  await t.setNow(IST('2026-12-02', '10:00'));
  await bill(w.cust.A, '2026-12-01', '2026-12-01', 0);
  await t.setNow(IST('2026-12-03', '10:00'));
  await jobs();
  assert.deepEqual(await fees(w.cust.A), [{ amt: 8000 }]);                 // not ₹8,00,000
});

test('late fee: an exempt customer\'s bill stays fee-free even if the exemption is removed later', async () => {
  const { w, t, u, fees, decisions, deliver, fee, bill, jobs } = await fresh();
  await fee({ late_fee_enabled: true, late_fee_type: 'flat', late_fee_value: 5000 });
  await t.as(u.owner, `update public.customers set late_fee_mode = 'exempt' where id = $1`, [w.cust.A]);
  await deliver(w.cust.A, '2026-12-01');
  await t.setNow(IST('2026-12-02', '10:00'));
  await bill(w.cust.A, '2026-12-01', '2026-12-01', 0);
  await t.setNow(IST('2026-12-03', '10:00'));
  await jobs();
  await t.as(u.owner, `update public.customers set late_fee_mode = 'follow_global' where id = $1`, [w.cust.A]);
  await t.setNow(IST('2026-12-04', '10:00'));
  await jobs();
  assert.deepEqual(await fees(w.cust.A), []);
  assert.deepEqual(await decisions(w.cust.A), [{ outcome: 'exempt', amt: 0 }]);
});

// ------------------------------------------------------------------ 2. step-up on direct writes (MEDIUM)
test('money-affecting direct edits need a recent authenticator code; everyday edits do not', async () => {
  const { w, t, u } = await fresh();
  // tiffin pricing mode
  await rejects(t.as(u.owner, `update public.tiffin_types set pricing_mode = 'sum_of_items' where id = $1`, [w.types.veg], STALE), 'STEP_UP_REQUIRED');
  await t.as(u.owner, `update public.tiffin_types set name = 'Veg Thali' where id = $1`, [w.types.veg], STALE);   // a name is fine
  // archiving a customer (it removes their future meals and their app access)
  await rejects(t.as(u.owner, `update public.customers set status = 'archived' where id = $1`, [w.cust.B], STALE), 'STEP_UP_REQUIRED');
  await t.as(u.owner, `update public.customers set status = 'paused' where id = $1`, [w.cust.B], STALE);
  // late-skip overrides
  await rejects(t.as(u.owner, `update public.customers set late_skip_charge_percent_override = 0 where id = $1`, [w.cust.A], STALE), 'STEP_UP_REQUIRED');
  await rejects(t.as(u.owner, `insert into public.customers (kitchen_id, full_name, late_fee_mode) values ($1, 'X', 'exempt')`, [w.k1], STALE), 'STEP_UP_REQUIRED');
  await t.as(u.owner, `insert into public.customers (kitchen_id, full_name) values ($1, 'New person')`, [w.k1], STALE);
  // the owner of another kitchen still can't touch ours, code or not
  assert.equal((await t.as(u.owner2, `update public.customers set status = 'archived' where id = $1 returning id`, [w.cust.A])).length, 0);
});

test('tiffin contents: one all-or-nothing call; step-up only once the tiffin is in use; inputs checked', async () => {
  const { w, t, u } = await fresh();
  await rejects(t.as(u.owner, 'insert into public.tiffin_type_items (kitchen_id, tiffin_type_id, item_id, qty) values ($1, $2, $3, 2)',
    [w.k1, w.types.veg, w.items.salad]), 'permission denied');
  await rejects(t.as(u.owner, 'delete from public.tiffin_type_items where tiffin_type_id = $1', [w.types.veg]), 'permission denied');
  const set = (type, items, opts) => t.as(u.owner, 'select public.owner_set_tiffin_items($1, $2::jsonb)', [type, JSON.stringify(items)], opts);
  // Veg Standard has subscriptions: a stale session can't change what goes in it
  await rejects(set(w.types.veg, [{ item_id: w.items.roti, qty: 20 }], STALE), 'STEP_UP_REQUIRED');
  await set(w.types.veg, [{ item_id: w.items.roti, qty: 5 }, { item_id: w.items.salad, qty: 1 }]);
  assert.deepEqual(await t.sql('select item_id, qty from public.tiffin_type_items where tiffin_type_id = $1 order by qty', [w.types.veg]),
    [{ item_id: w.items.salad, qty: 1 }, { item_id: w.items.roti, qty: 5 }]);
  // a brand-new tiffin nobody has ordered: no prompt needed
  const [{ id: fresh2 }] = await t.as(u.owner, `insert into public.tiffin_types (kitchen_id, name) values ($1, 'Mini') returning id`, [w.k1]);
  await set(fresh2, [{ item_id: w.items.roti, qty: 2 }], STALE);
  for (const bad of [[{ item_id: w.items.k2item, qty: 1 }], [{ item_id: w.items.roti, qty: 0 }], [{ item_id: w.items.roti, qty: 21 }],
    [{ item_id: w.items.roti, qty: 1 }, { item_id: w.items.roti, qty: 2 }], [{ item_id: 'x', qty: 1 }], {}]) {
    await rejects(set(fresh2, bad), 'INVALID_REQUEST');
  }
  await rejects(t.as(u.owner2, 'select public.owner_set_tiffin_items($1, $2::jsonb)', [w.types.veg, '[]']), 'NOT_ALLOWED');
  await rejects(t.as(u.custA, 'select public.owner_set_tiffin_items($1, $2::jsonb)', [w.types.veg, '[]']), 'NOT_ALLOWED');
});

test('undoing a delivered meal (a refund in effect) needs step-up; marking delivered does not', async () => {
  const { w, t, u } = await fresh();
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.as(u.owner, 'select public.owner_set_order_status($1, $2, null)', [o.id, 'delivered'], STALE);
  await rejects(t.as(u.owner, 'select public.owner_set_order_status($1, $2, $3)', [o.id, 'skipped', 'oops'], STALE), 'STEP_UP_REQUIRED');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, $3)', [o.id, 'skipped', 'Phoned in sick']);
  assert.equal((await t.sql('select coalesce(sum(amount_paise), 0)::int b from public.ledger_entries where order_id = $1', [o.id]))[0].b, 0);
});

// ------------------------------------------------------------------ 3. unbounded growth (MEDIUM)
test('one customer cannot grow tables without limit; saved locations keep the newest 20', async () => {
  const { w, t, u } = await fresh();
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  let refused = 0;
  for (let i = 1; i <= 35; i++) {
    try { await t.call(u.custA, 'public.customer_set_location($1, null, $2)', [o.id, `Desk ${i}`]); }
    catch (e) { assert.match(String(e.message), /TOO_MANY_REQUESTS/); refused++; }
  }
  assert.equal(refused, 5);                                                  // 30 new places per hour
  assert.equal((await t.sql('select count(*)::int n from public.customer_saved_locations where customer_id = $1', [w.cust.A]))[0].n, 20);
  for (let i = 0; i < 20; i++) {
    const d = `2027-01-${String(i + 1).padStart(2, '0')}`;
    await t.call(u.custA, 'public.customer_skip_range($1, $2::date, $3::date, null)', [w.k1, d, d]);
  }
  await rejects(t.call(u.custA, 'public.customer_skip_range($1, $2::date, $3::date, null)', [w.k1, '2027-02-01', '2027-02-01']), 'TOO_MANY_REQUESTS');
});

// ------------------------------------------------------------------ 4. closures (LOW-MEDIUM)
test('cancelling a closure brings back each meal as it was: a skipped meal stays skipped', async () => {
  const { w, t, u } = await fresh();
  const a = await w.order(w.cust.A, '2026-12-03', 'lunch');
  const b = await w.order(w.cust.B, '2026-12-03', 'lunch');
  await t.call(u.custA, 'public.customer_skip_meal($1)', [a.id]);
  const cl = await t.call(u.owner, 'public.owner_add_closure($1, $2::date, $3, $4)', [w.k1, '2026-12-03', 'lunch', 'Festival']);
  await t.call(u.owner, 'public.owner_cancel_closure($1)', [cl]);
  const st = async (id) => (await t.sql('select status, status_before_closure from public.orders where id = $1', [id]))[0];
  assert.deepEqual(await st(a.id), { status: 'skipped', status_before_closure: null });
  assert.deepEqual(await st(b.id), { status: 'scheduled', status_before_closure: null });
});

// ------------------------------------------------------------------ 5. early delivery (LOW)
test('a meal cannot be marked delivered before the customer\'s free-skip cutoff', async () => {
  const { w, t, u } = await fresh();
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');                 // delivery 13:30, extras/skip cutoff 11:00
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${o.id}}`, w.staff.delivery]);
  await t.setNow(IST('2026-12-01', '00:05'));
  await rejects(t.call(u.delivery, 'public.staff_mark_delivered($1)', [o.id]), 'TOO_EARLY');
  await t.setNow(IST('2026-12-01', '10:59'));
  await rejects(t.call(u.delivery, 'public.staff_mark_delivered($1)', [o.id]), 'TOO_EARLY');
  assert.equal((await t.call(u.custA, 'public.customer_skip_meal($1)', [o.id])).status, 'skipped');   // still the customer's choice
  await t.call(u.custA, 'public.customer_unskip_meal($1)', [o.id]);
  await t.setNow(IST('2026-12-01', '11:00'));
  assert.equal((await t.call(u.delivery, 'public.staff_mark_delivered($1)', [o.id])).status, 'delivered');
  assert.equal((await t.call(u.delivery, 'public.staff_mark_delivered($1)', [o.id])).status, 'delivered');   // offline retry
});

// ------------------------------------------------------------------ 7. audit (LOW)
test('invite code hashes never reach the permanent audit log', async () => {
  const { w, t, u } = await fresh();
  const [{ id: newCust }] = await t.as(u.owner, `insert into public.customers (kitchen_id, full_name) values ($1, 'Meera') returning id`, [w.k1]);
  await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [newCust]);
  const [{ n }] = await t.sql(`select count(*)::int n from public.audit_log where table_name = 'invites'
                               and (coalesce(new_data, '{}') ? 'code_hash' or coalesce(old_data, '{}') ? 'code_hash')`);
  assert.equal(n, 0);
  assert.ok((await t.sql(`select count(*)::int n from public.audit_log where table_name = 'invites' and action = 'INSERT'`))[0].n > 0);
});

// ------------------------------------------------------------------ 8. boxes (LOW)
test('boxes: collected only after delivery; only packing staff record which box went out', async () => {
  const { w, t, u } = await fresh();
  await t.call(u.owner, 'public.owner_create_boxes($1, 2)', [w.k1]);
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await rejects(t.call(u.delivery, 'public.staff_box_issued($1, $2)', [o.id, 'AK-001']), 'NOT_FOUND');   // delivery-only role
  await t.call(u.kitchen, 'public.staff_box_issued($1, $2)', [o.id, 'AK-001']);
  // an unassigned delivery person walking the codes before delivery learns nothing and collects nothing
  await rejects(t.call(u.delivery2, 'public.staff_box_scan_collect($1, $2, null)', [w.k1, 'AK-001']), 'BOX_NOT_DELIVERED');
  await rejects(t.call(u.delivery2, 'public.staff_box_scan_collect($1, $2, null)', [w.k1, 'AK-002']), 'BOX_NOT_ISSUED');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  assert.equal((await t.call(u.delivery2, 'public.staff_box_scan_collect($1, $2, null)', [w.k1, 'AK-001'])).customer_name, 'Priya');
  assert.equal((await t.as(u.owner, 'select * from public.owner_boxes_out($1)', [w.k1])).length, 0);
});

// ------------------------------------------------------------------ 9. storage (LOW)
test('storage: only the standard id spelling, and a daily upload limit per person', async () => {
  const { w, t, u } = await fresh();
  const put = (user, name) => t.as(user, `insert into storage.objects (bucket_id, name, owner_id) values ('payment-proofs', $1, $2)`, [name, user.id]);
  const id = () => crypto.randomUUID();
  await put(u.custA, `${w.k1}/${w.cust.A}/${id()}.jpg`);
  const weird = String(w.cust.A).replace(/-/g, '').replace(/^(.{4})/, '$1-');   // same uuid, hyphens moved
  await rejects(put(u.custA, `${w.k1}/${weird}/${id()}.jpg`), 'row-level security');
  await rejects(put(u.custA, `${w.k1.toUpperCase()}/${w.cust.A}/${id()}.jpg`), 'row-level security');
  // 150 files in a day is the limit for customers and staff
  await t.sql(`insert into storage.objects (bucket_id, name, owner_id)
               select 'payment-proofs', $1 || '/' || $2 || '/' || gen_random_uuid() || '.jpg', $3 from generate_series(1, 149)`,
    [w.k1, w.cust.A, u.custA.id]);
  await rejects(put(u.custA, `${w.k1}/${w.cust.A}/${id()}.jpg`), 'row-level security');
  await put(u.custB, `${w.k1}/${w.cust.B}/${id()}.jpg`);                     // others are unaffected
});

test('stored file paths must point into the row\'s own kitchen folder', async () => {
  const { w, t, u } = await fresh();
  await rejects(t.as(u.owner, 'update public.location_nodes set directions_voice_path = $1 where id = $2',
    [`${w.k2}/${w.cust.C}/${crypto.randomUUID()}.m4a`, w.ward5]), 'check constraint');
  await t.as(u.owner, 'update public.location_nodes set directions_voice_path = $1 where id = $2',
    [`${w.k1}/${crypto.randomUUID()}.m4a`, w.ward5]);
});

// ------------------------------------------------------------------ 10. home addresses (LOW)
test('customers never see another customer\'s home; owner and staff see every place', async () => {
  const { w, t, u } = await fresh();
  const [{ id: home }] = await t.as(u.owner, `insert into public.places (kitchen_id, name, kind) values ($1, 'Anil home', 'home') returning id`, [w.k1]);
  const [{ id: door }] = await t.as(u.owner, `insert into public.location_nodes (kitchen_id, place_id, name, directions)
                                               values ($1, $2, 'Flat 12', 'Blue gate, 2nd floor') returning id`, [w.k1, home]);
  await t.as(u.owner, 'update public.customers set default_location_node_id = $1 where id = $2', [door, w.cust.B]);
  const sees = async (user) => (await t.as(user, 'select id from public.location_nodes where id = $1', [door])).length === 1
    && (await t.as(user, 'select id from public.places where id = $1', [home])).length === 1;
  assert.equal(await sees(u.custA), false);
  assert.equal(await sees(u.custB), true);
  assert.equal(await sees(u.owner), true);
  assert.equal(await sees(u.delivery), true);
  assert.equal(await sees(u.custC), false);
  assert.equal((await t.as(u.custA, 'select id from public.places where id = $1', [w.place])).length, 1);   // shared places still listed
});

// ------------------------------------------------------------------ 11. devices
test('"sign out on all my devices" stops alerts to every other phone of that person only', async () => {
  const { t, u } = await fresh();
  const reg = (user, token) => t.call(user, 'public.register_device($1, $2, null, null)', ['android', token]);
  const keep = await reg(u.custA, 'ExponentPushToken[aaaaaaaaaaaa]');
  await reg(u.custA, 'ExponentPushToken[bbbbbbbbbbbb]');
  await reg(u.custA, 'ExponentPushToken[cccccccccccc]');
  await reg(u.custB, 'ExponentPushToken[dddddddddddd]');
  assert.equal(await t.call(u.custA, 'public.forget_other_devices($1)', [keep]), 2);
  assert.deepEqual((await t.sql('select expo_push_token from public.devices order by 1')).map((r) => r.expo_push_token),
    ['ExponentPushToken[aaaaaaaaaaaa]', 'ExponentPushToken[dddddddddddd]']);
  await rejects(t.as(null, 'select public.forget_other_devices(null)'), 'permission denied');
});

// ------------------------------------------------------------------ 12. right to erasure
test('erasing a customer removes personal data everywhere, keeps the money records, and needs step-up', async () => {
  const { w, t, u } = await fresh();
  const o = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.call(u.custA, 'public.customer_set_location($1, null, $2)', [o.id, 'Desk 7, near window']);
  await t.call(u.custA, 'public.customer_send_message($1, $2)', [w.k1, 'Less spicy please']);
  await t.call(u.custA, 'public.register_device($1, $2, null, null)', ['android', 'ExponentPushToken[erase-me-1234]']);
  await t.call(u.custA, 'public.customer_refer_friend($1, $2, $3, null)', [w.k1, 'Ritu', '9876543210']);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  await t.sql(`insert into storage.objects (bucket_id, name, owner_id) values ('voice-notes', $1, $2)`,
    [`${w.k1}/${w.cust.A}/${crypto.randomUUID()}.webm`, u.custA.id]);

  await rejects(t.call(u.owner, 'public.owner_erase_customer($1)', [w.cust.A]), 'ARCHIVE_FIRST');
  await t.as(u.owner, `update public.customers set status = 'archived' where id = $1`, [w.cust.A]);
  await rejects(t.as(u.owner, 'select public.owner_erase_customer($1)', [w.cust.A], STALE), 'STEP_UP_REQUIRED');
  await rejects(t.call(u.owner2, 'public.owner_erase_customer($1)', [w.cust.A]), 'NOT_ALLOWED');
  await rejects(t.call(u.custA, 'public.owner_erase_customer($1)', [w.cust.A]), 'NOT_ALLOWED');
  await t.call(u.owner, 'public.owner_erase_customer($1)', [w.cust.A]);

  const [c] = await t.sql('select full_name, phone, email, food_notes, user_id, erased_at is not null as erased from public.customers where id = $1', [w.cust.A]);
  assert.deepEqual(c, { full_name: 'Deleted customer', phone: null, email: null, food_notes: null, user_id: null, erased: true });
  const count = async (q, p) => (await t.sql(q, p))[0].n;
  assert.equal(await count('select count(*)::int n from public.devices where user_id = $1', [u.custA.id]), 0);
  assert.equal(await count('select count(*)::int n from public.customer_saved_locations where customer_id = $1', [w.cust.A]), 0);
  assert.equal(await count(`select count(*)::int n from public.chat_messages where customer_id = $1 and body <> '(deleted)'`, [w.cust.A]), 0);
  assert.equal(await count('select count(*)::int n from public.orders where customer_id = $1 and location_text is not null', [w.cust.A]), 0);
  assert.equal(await count(`select count(*)::int n from public.referral_requests where referrer_customer_id = $1 and friend_phone <> '0000000'`, [w.cust.A]), 0);
  // the money stays (accounts), under the anonymous name
  assert.equal(await count(`select count(*)::int n from public.ledger_entries where customer_id = $1 and kind = 'meal'`, [w.cust.A]), 1);
  // no copy of the contact details in the permanent audit log
  const leaks = await count(`select count(*)::int n from public.audit_log where table_name = 'customers'
    and (coalesce(new_data, '{}')::text || coalesce(old_data, '{}')::text) ~ '(Priya|9800000001|less spicy)'`, []);
  assert.equal(leaks, 0);
  // the files go in the next clean-up
  assert.equal((await t.asService('select * from public.media_expired(100)')).filter((r) => r.name.includes(w.cust.A)).length, 1);
  // the person's login can no longer see anything of this kitchen
  assert.equal((await t.as(u.custA, 'select id from public.orders')).length, 0);
});
