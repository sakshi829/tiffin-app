// Attack tests: direct writes, IDOR/BOLA, payload tampering, privilege
// escalation, immutability. Every one of these MUST fail.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, oA, oB, oC, addonB;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  oA = await w.order(w.cust.A, '2026-12-02', 'lunch');
  oB = await w.order(w.cust.B, '2026-12-02', 'lunch');
  oC = await w.order(w.cust.C, '2026-12-02', 'lunch');
  const bd = await w.order(w.cust.B, '2026-12-02', 'dinner');
  addonB = (await t.sql('select id from public.order_addons where order_id = $1', [bd.id]))[0].id;
});
after(async () => { await t.close(); });

// ---------------------------------------------------------------- direct writes
test('customers cannot write any table directly', async () => {
  await rejects(t.as(u.custA, 'update public.orders set unit_price_paise = 1 where id = $1', [oA.id]), 'permission denied');
  await rejects(t.as(u.custA, `update public.orders set status = 'delivered' where id = $1`, [oA.id]), 'permission denied');
  await rejects(t.as(u.custA, `insert into public.ledger_entries (kitchen_id, customer_id, entry_date, kind, amount_paise, payment_id)
                               values ($1, $2, '2026-12-01', 'payment', -100000, gen_random_uuid())`, [w.k1, w.cust.A]), 'permission denied');
  await rejects(t.as(u.custA, `insert into public.items (kitchen_id, name) values ($1, 'Free food')`, [w.k1]), 'row-level security');
  await rejects(t.as(u.custA, 'delete from public.orders where id = $1', [oA.id]), 'permission denied');
});

test('customer update of own profile through RLS affects zero rows (owner-only table)', async () => {
  const rows = await t.as(u.custA, `update public.customers set food_notes = 'hacked' where id = $1 returning id`, [w.cust.A]);
  assert.equal(rows.length, 0);
  assert.equal((await t.sql('select food_notes from public.customers where id = $1', [w.cust.A]))[0].food_notes, 'less spicy');
});

test('nobody can hijack an account link: customers.user_id is not writable, even by the owner', async () => {
  await rejects(t.as(u.custA, 'update public.customers set user_id = $1 where id = $2', [u.custA.id, w.cust.B]), 'permission denied');
  await rejects(t.as(u.owner, 'update public.customers set user_id = $1 where id = $2', [u.stranger.id, w.cust.A]), 'permission denied');
});

test('owner cannot write orders, ledger, payments or prices directly (functions only)', async () => {
  await rejects(t.as(u.owner, 'update public.orders set unit_price_paise = 1 where id = $1', [oA.id]), 'permission denied');
  await rejects(t.as(u.owner, 'update public.ledger_entries set amount_paise = 1'), 'permission denied');
  await rejects(t.as(u.owner, 'delete from public.ledger_entries'), 'permission denied');
  await rejects(t.as(u.owner, `insert into public.item_prices (kitchen_id, item_id, price_paise, effective_from) values ($1, $2, 1, '2026-01-01')`,
    [w.k1, w.items.egg]), 'permission denied');
  await rejects(t.as(u.owner, 'delete from public.audit_log'), 'permission denied');
});

test('ledger, audit log, bills and box movements are immutable even for the database owner', async () => {
  const oA1 = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [oA1.id, 'delivered']);
  await rejects(t.sql('update public.ledger_entries set amount_paise = 1'), 'IMMUTABLE');
  await rejects(t.sql('delete from public.ledger_entries'), 'IMMUTABLE');
  await rejects(t.sql('delete from public.audit_log'), 'IMMUTABLE');
  await rejects(t.sql(`update public.audit_log set actor_role = 'x'`), 'IMMUTABLE');
  await t.call(u.owner, 'public.owner_record_payment($1, 5000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', 'idem-imm-0001']);
  await rejects(t.sql('delete from public.payments'), 'IMMUTABLE');
  await t.sql(`insert into public.item_prices (kitchen_id, item_id, price_paise, effective_from) values ($1, $2, 1200, '2026-11-01')`,
    [w.k1, w.items.egg]);
  await rejects(t.sql(`update public.item_prices set price_paise = 1 where effective_from = '2026-11-01'`), 'IMMUTABLE');
  await rejects(t.sql(`delete from public.item_prices where effective_from = '2026-11-01'`), 'IMMUTABLE');
});

test('owner cannot write into another kitchen (RLS with check + composite FKs)', async () => {
  await rejects(t.as(u.owner, `insert into public.items (kitchen_id, name) values ($1, 'Spy')`, [w.k2]), 'row-level security');
  await rejects(t.as(u.owner, `insert into public.location_nodes (kitchen_id, place_id, name) values ($1, $2, 'x')`,
    [w.k1, (await t.sql('select place_id from public.location_nodes where id = $1', [w.k2node]))[0].place_id]), 'foreign key');
  const rows = await t.as(u.owner, `update public.items set name = 'renamed' where id = $1 returning id`, [w.items.k2item]);
  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------- IDOR via functions
test('IDOR: customer A cannot act on customer B\'s (or another kitchen\'s) records', async () => {
  for (const target of [oB.id, oC.id]) {
    await rejects(t.call(u.custA, 'public.customer_set_location($1, null, $2)', [target, 'Ward 9']), 'NOT_FOUND');
    await rejects(t.call(u.custA, 'public.customer_skip_meal($1)', [target]), 'NOT_FOUND');
    await rejects(t.call(u.custA, 'public.customer_unskip_meal($1)', [target]), 'NOT_FOUND');
    await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [target, w.items.egg]), 'NOT_FOUND');
    await rejects(t.call(u.custA, 'public.customer_mark_box_kept($1, $2, null)', [target, 'desk']), 'NOT_FOUND');
  }
  await rejects(t.call(u.custA, 'public.customer_cancel_addon($1)', [addonB]), 'NOT_FOUND');
  await rejects(t.call(u.custA, 'public.customer_submit_payment($1, 1000, $2, $3, $4, null)', [w.k2, 'UTRX999999', '2026-12-01', 'idem-x-0001']), 'NOT_FOUND');
  await rejects(t.call(u.custA, 'public.my_balance($1)', [w.k2]), 'NOT_FOUND');
  const skip = await t.call(u.custB, 'public.customer_skip_range($1, $2::date, $3::date, null)', [w.k1, '2026-12-06', '2026-12-07']);
  await rejects(t.call(u.custA, 'public.customer_cancel_skip_range($1)', [skip.skip_id]), 'NOT_FOUND');
  // nothing about B changed
  const after = await w.order(w.cust.B, '2026-12-02', 'lunch');
  assert.equal(after.status, 'scheduled');
  assert.equal(after.location_text, null);
});

test('IDOR: owner of kitchen 2 cannot touch kitchen 1 through owner functions', async () => {
  await rejects(t.call(u.owner2, 'public.owner_set_order_status($1, $2, null)', [oA.id, 'delivered']), 'NOT_ALLOWED');
  await rejects(t.call(u.owner2, 'public.owner_record_payment($1, 1000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', 'idem-k2-0001']), 'NOT_ALLOWED');
  await rejects(t.call(u.owner2, 'public.owner_create_customer_invite($1, 7)', [w.cust.A]), 'NOT_ALLOWED|ALREADY_LINKED');
  await rejects(t.call(u.owner2, 'public.owner_set_item_price($1, 1, $2)', [w.items.egg, '2026-12-05']), 'NOT_ALLOWED');
  await rejects(t.call(u.owner2, 'public.owner_assign_orders($1, $2::uuid[], null)', [w.k1, `{${oA.id}}`]), 'NOT_ALLOWED');
});

// ---------------------------------------------------------------- privilege escalation
test('customers and staff cannot call owner functions', async () => {
  for (const user of [u.custA, u.delivery, u.kitchen, u.stranger]) {
    await rejects(t.call(user, 'public.owner_set_order_status($1, $2, null)', [oA.id, 'delivered']), 'NOT_ALLOWED');
    await rejects(t.call(user, 'public.owner_record_payment($1, 100000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', `idem-${user.label}-01`]), 'NOT_ALLOWED');
    await rejects(t.call(user, 'public.owner_add_closure($1, $2::date, null, null)', [w.k1, '2026-12-05']), 'NOT_ALLOWED');
    await rejects(t.call(user, 'public.owner_create_staff_invite($1, $2, $3, 3)', [w.k1, 'delivery', 'Evil']), 'NOT_ALLOWED');
  }
});

test('customers cannot call staff functions; staff cannot act as customers', async () => {
  await rejects(t.call(u.custA, 'public.staff_my_tasks($1, $2::date, null)', [w.k1, '2026-12-02']), 'NOT_ALLOWED');
  await rejects(t.call(u.custA, 'public.staff_mark_delivered($1)', [oA.id]), 'NOT_FOUND');
  await rejects(t.call(u.delivery, 'public.customer_skip_meal($1)', [oA.id]), 'NOT_FOUND');
});

test('an owner role can never be created through invites', async () => {
  await rejects(t.call(u.owner, 'public.owner_create_staff_invite($1, $2, $3, 3)', [w.k1, 'owner', 'Second owner']), 'INVALID_ROLE');
  await rejects(t.call(u.owner, 'public.owner_set_staff($1, $2, true, true)', [w.staff.delivery, 'owner']), 'INVALID_ROLE');
});

test('step-up: dangerous owner actions need a FRESH authenticator code', async () => {
  const stale = { mfaAgoSec: 3600 };
  await rejects(t.call(u.owner, 'public.owner_set_item_price($1, 9999, $2)', [w.items.egg, '2026-12-05'], stale), 'STEP_UP_REQUIRED');
  await rejects(t.call(u.owner, 'public.owner_unlink_customer($1)', [w.cust.A], stale), 'STEP_UP_REQUIRED');
  await rejects(t.call(u.owner, 'public.owner_add_ledger_entry($1, $2, 1000, $3, null)', [w.cust.A, 'waiver', 'goodwill'], stale), 'STEP_UP_REQUIRED');
  await rejects(t.call(u.owner, `public.owner_update_settings($1, '{"signup_mode":"open"}'::jsonb)`, [w.k1], stale), 'STEP_UP_REQUIRED');
  await rejects(t.call(u.owner, 'public.owner_create_staff_invite($1, $2, $3, 3)', [w.k1, 'delivery', 'X'], stale), 'STEP_UP_REQUIRED');
  // without MFA at all -> not even an owner
  await rejects(t.call(u.owner, 'public.owner_set_item_price($1, 9999, $2)', [w.items.egg, '2026-12-05'], { aal: 'aal1' }), 'NOT_ALLOWED');
  // fresh code -> allowed
  await t.call(u.owner, 'public.owner_set_item_price($1, 1600, $2)', [w.items.egg, '2026-12-05']);
});

test('step-up reads only timestamped TOTP entries (fails closed on any other AMR shape)', async () => {
  const now = Math.floor(t.nowMs / 1000);
  const call = (amr) => t.call(u.owner, 'public.owner_set_item_price($1, 1650, $2)', [w.items.egg, '2026-12-06'], { amr });
  await call([{ method: 'mfa/totp', timestamp: now - 30 }]);                                         // alternate name accepted
  await rejects(call(['otp', 'totp']), 'STEP_UP_REQUIRED');                                          // RFC-8176 strings: no timestamp
  await rejects(call([{ method: 'otp', timestamp: now - 5 }]), 'STEP_UP_REQUIRED');                  // email code is not MFA
  await rejects(call([{ method: 'totp', timestamp: 'now' }]), 'STEP_UP_REQUIRED');                   // malformed
  await rejects(call({ method: 'totp', timestamp: now }), 'STEP_UP_REQUIRED');                       // not an array
  await rejects(call([{ method: 'totp', timestamp: now - 11 * 60 }]), 'STEP_UP_REQUIRED');           // older than 10 min
});

// ---------------------------------------------------------------- payload tampering
test('tampering: add-on quantities, unavailable items, other kitchens\' items', async () => {
  for (const qty of [-5, 0, 5, 999]) {   // egg max = 4
    await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, $3)', [oA.id, w.items.egg, qty]), 'INVALID_QUANTITY');
  }
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [oA.id, w.items.roti]), 'ITEM_NOT_AVAILABLE');    // not orderable
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [oA.id, w.items.pickle]), 'ITEM_NOT_AVAILABLE');  // inactive
  await rejects(t.call(u.custA, 'public.customer_request_addon($1, $2, 1)', [oA.id, w.items.k2item]), 'ITEM_NOT_AVAILABLE'); // other kitchen
});

test('tampering: the client can never set a price; the server uses the menu price', async () => {
  // INPUT parameters only (proargnames also lists RETURNS TABLE output columns, e.g. a menu's price).
  const fns = await t.sql(`select p.proname, coalesce(p.proargnames, '{}') as names, p.proargmodes as modes
                           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and (p.proname like 'customer_%' or p.proname like 'staff_%')`);
  for (const f of fns) {
    const inputs = f.names.filter((_, i) => !f.modes || ['i', 'b'].includes(f.modes[i]));
    for (const arg of inputs) assert.doesNotMatch(arg, /price/, `${f.proname} accepts a price (${arg})`);
  }
  const r = await t.call(u.custA, 'public.customer_request_addon($1, $2, 2)', [oA.id, w.items.egg]);
  assert.equal(r.unit_price_paise, 1500);
});

test('tampering: location text length, control characters, foreign location ids, injection', async () => {
  await rejects(t.call(u.custA, 'public.customer_set_location($1, null, $2)', [oA.id, 'x'.repeat(121)]), 'TEXT_TOO_LONG');
  await rejects(t.call(u.custA, 'public.customer_set_location($1, null, $2)', [oA.id, 'ward\u0000 5']), 'INVALID_TEXT|invalid byte|0x00');
  await rejects(t.call(u.custA, 'public.customer_set_location($1, null, $2)', [oA.id, 'ward\u0007 5']), 'INVALID_TEXT');
  await rejects(t.call(u.custA, 'public.customer_set_location($1, $2, null)', [oA.id, w.k2node]), 'INVALID_LOCATION');
  await rejects(t.call(u.custA, 'public.customer_set_location($1, null, $2)', [oA.id, '   ']), 'LOCATION_REQUIRED');
  const evil = `'); drop table public.orders; --`;
  await t.call(u.custA, 'public.customer_set_location($1, null, $2)', [oA.id, evil]);
  assert.equal((await w.order(w.cust.A, '2026-12-02', 'lunch')).location_text, evil);   // stored as plain text
  assert.ok((await t.sql('select count(*)::int n from public.orders'))[0].n > 0);       // table still there
});

test('tampering: payments (amount, UTR, dates, replay, UTR reuse, self-confirm)', async () => {
  const pay = (amt, utr, date, key) =>
    t.call(u.custA, 'public.customer_submit_payment($1, $2, $3, $4, $5, null)', [w.k1, amt, utr, date, key]);
  await rejects(pay(0, 'UTR1234567', '2026-12-01', 'k-amt-0001'), 'INVALID_AMOUNT');
  await rejects(pay(-5000, 'UTR1234567', '2026-12-01', 'k-amt-0002'), 'INVALID_AMOUNT');
  await rejects(pay(500000000, 'UTR1234567', '2026-12-01', 'k-amt-0003'), 'INVALID_AMOUNT');
  await rejects(pay(5000, 'UTR-12 34', '2026-12-01', 'k-utr-0001'), 'INVALID_UTR');
  await rejects(pay(5000, 'UTR1234567', '2026-12-25', 'k-dat-0001'), 'INVALID_DATES');
  await rejects(pay(5000, 'UTR1234567', '2026-01-01', 'k-dat-0002'), 'INVALID_DATES');
  await rejects(pay(5000, 'UTR1234567', '2026-12-01', 'short'), 'INVALID_REQUEST');

  const first = await pay(5000, 'utr1234567', '2026-12-01', 'k-ok-00001');
  const replay = await pay(5000, 'UTR1234567', '2026-12-01', 'k-ok-00001');
  assert.equal(replay.payment_id, first.payment_id);                       // replay -> same payment
  // A repeated UTR is NOT refused (that would let anyone probe UTRs or block a real payer by
  // submitting their UTR first). It is accepted and flagged; only one can ever be confirmed.
  const second = await pay(5000, 'UTR1234567', '2026-12-01', 'k-ok-00002');
  const pending = await t.as(u.owner, 'select id, same_utr_count from public.owner_pending_payments($1) order by created_at', [w.k1]);
  assert.deepEqual(pending.map((p) => p.same_utr_count), [1, 1]);
  assert.equal((await t.as(u.custA, 'select * from public.owner_pending_payments($1)', [w.k1])).length, 0);   // owner only
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [second.payment_id]);
  await rejects(t.call(u.owner, 'public.owner_confirm_payment($1)', [first.payment_id]), 'UTR_ALREADY_USED');
  await rejects(t.call(u.custB, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)',
    [w.k1, 'UTR1234567', '2026-12-01', 'k-ok-00001']), 'INVALID_REQUEST');  // B cannot reuse A's key
  await rejects(t.call(u.custA, 'public.owner_confirm_payment($1)', [first.payment_id]), 'NOT_ALLOWED');
  const n = (await t.sql('select count(*)::int n from public.ledger_entries where payment_id = $1', [first.payment_id]))[0].n;
  assert.equal(n, 0, 'unconfirmed payment must not credit the ledger');
  const n2 = (await t.sql('select count(*)::int n from public.ledger_entries where payment_id = $1', [second.payment_id]))[0].n;
  assert.equal(n2, 1, 'the confirmed one credits exactly once');
});

test('tampering: owner inputs are validated too', async () => {
  await rejects(t.call(u.owner, 'public.owner_set_item_price($1, -1, $2)', [w.items.egg, '2026-12-05']), 'INVALID_AMOUNT');
  await rejects(t.call(u.owner, 'public.owner_set_item_price($1, 99999999, $2)', [w.items.egg, '2026-12-05']), 'INVALID_AMOUNT');
  await rejects(t.call(u.owner, 'public.owner_set_item_price($1, 100, $2)', [w.items.egg, '2026-11-01']), 'PAST_DATE');
  await rejects(t.call(u.owner, `public.owner_update_settings($1, '{"is_admin":true}'::jsonb)`, [w.k1]), 'INVALID_SETTING');
  await rejects(t.call(u.owner, `public.owner_update_settings($1, '{"late_skip_charge_percent":500}'::jsonb)`, [w.k1]), 'check constraint');
  await rejects(t.call(u.owner, 'public.owner_add_ledger_entry($1, $2, 1000, $3, null)', [w.cust.A, 'payment', 'fake payment']), 'INVALID_KIND');
  await rejects(t.call(u.owner, 'public.owner_add_ledger_entry($1, $2, 1000, null, null)', [w.cust.A, 'waiver']), 'NOTE_REQUIRED');
});
