// Phase 5a billing: late fees (never retroactive, once per bill, exemptions), due reminders,
// low-advance alerts, month bills, kitchen contact phone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
const ledger = (cust, kind) => t.sql('select amount_paise::int as amt, note from public.ledger_entries where customer_id = $1 and kind = $2', [cust, kind]);
const alerts = (user, kind) => t.as(user, 'select title, body from public.notifications where kind = $1', [kind]);

before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  for (const c of [w.cust.A, w.cust.B]) {
    const o = await w.order(c, '2026-12-01', 'lunch');
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  }
});
after(async () => { await t.close(); });

test('kitchen phone number is a (step-up) setting', async () => {
  await t.call(u.owner, `public.owner_update_settings($1, '{"contact_phone":"98200 11111"}'::jsonb)`, [w.k1]);
  assert.equal((await t.as(u.custA, 'select contact_phone from public.business_settings'))[0].contact_phone, '98200 11111');
  await rejects(t.call(u.owner, `public.owner_update_settings($1, '{"contact_phone":"call me"}'::jsonb)`, [w.k1]), 'check constraint');
});

test('bills made BEFORE late fees were switched on never get a fee', async () => {
  await t.setNow(IST('2026-12-02', '10:00'));
  await t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, 1)', [w.cust.B, '2026-12-01', '2026-12-01']); // due Dec 2
  await t.setNow(IST('2026-12-03', '10:00'));
  await t.call(u.owner, `public.owner_update_settings($1, '{"late_fee_enabled":true,"late_fee_type":"flat","late_fee_value":5000}'::jsonb)`, [w.k1]);
  assert.equal((await t.sql('select late_fee_since::text d from public.business_settings where kitchen_id = $1', [w.k1]))[0].d, '2026-12-03');
  await t.setNow(IST('2026-12-10', '10:00'));
  await t.sql('select app.run_billing_jobs()');
  assert.deepEqual(await ledger(w.cust.B, 'late_fee'), []);
});

test('reminder 2 days before due, then ONE late fee after due; paying in time avoids it', async () => {
  await t.setNow(IST('2026-12-03', '10:00'));
  await t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, null)', [w.cust.A, '2026-12-01', '2026-12-02']); // due Dec 9 (2 + 7)
  await t.setNow(IST('2026-12-07', '10:00'));
  await t.sql('select app.run_billing_jobs()');
  const [rem] = await alerts(u.custA, 'due_reminder');
  assert.match(rem.body, /₹80 is due by 9 Dec .* A late fee applies after that date\./);
  await t.setNow(IST('2026-12-10', '10:00'));
  await t.sql('select app.run_billing_jobs()');
  await t.sql('select app.run_billing_jobs()');
  assert.deepEqual(await ledger(w.cust.A, 'late_fee'), [{ amt: 5000, note: 'Late fee for bill AK-202612-00002' }]);
  assert.equal((await alerts(u.custA, 'late_fee')).length, 1);
  assert.equal((await t.as(u.custA, 'select count(*)::int n from public.bill_late_fees'))[0].n, 1);
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.bill_late_fees'))[0].n, 0);
  await rejects(t.sql('delete from public.bill_late_fees'), 'IMMUTABLE');
});

test('exempt customers and fully paid bills: no reminder, no fee', async () => {
  const o = await w.order(w.cust.B, '2026-12-05', 'lunch');
  await t.setNow(IST('2026-12-05', '13:00'));
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  await t.as(u.owner, `update public.customers set late_fee_mode = 'exempt' where id = $1`, [w.cust.B]);
  await t.setNow(IST('2026-12-06', '10:00'));
  await t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, 1)', [w.cust.B, '2026-12-02', '2026-12-05']);
  await t.setNow(IST('2026-12-09', '10:00'));
  await t.sql('select app.run_billing_jobs()');
  assert.deepEqual(await ledger(w.cust.B, 'late_fee'), []);
  assert.equal((await alerts(u.custB, 'due_reminder')).length, 0, 'exempt: reminder has no fee warning and B is not due 2 days out');
});

test('low advance alert: once a day, only for advance customers with an active plan', async () => {
  await t.as(u.owner, `update public.customers set billing_mode = 'advance' where id = $1`, [w.cust.A]);
  await t.call(u.owner, 'public.owner_record_payment($1, 20000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-09', 'adv-pay-0001']);
  // A balance: 8000 + 5000 fee - 20000 = -7000 (₹70 credit) < ₹200 threshold
  await t.sql('select app.run_billing_jobs()');
  await t.sql('select app.run_billing_jobs()');
  const low = await alerts(u.custA, 'low_balance');
  assert.equal(low.length, 1);
  assert.equal(low[0].body, 'Advance left: ₹70. Please top up soon.');
  assert.equal((await alerts(u.custB, 'low_balance')).length, 0);
});

test('bills for a whole finished month: everyone with activity, once', async () => {
  await t.setNow(IST('2027-01-02', '10:00'));
  await rejects(t.call(u.owner, 'public.owner_generate_month_bills($1, $2::date)', [w.k1, '2027-01-01']), 'INVALID_DATES');
  const n = await t.call(u.owner, 'public.owner_generate_month_bills($1, $2::date)', [w.k1, '2026-12-15']);
  assert.equal(n, 2);
  assert.equal(await t.call(u.owner, 'public.owner_generate_month_bills($1, $2::date)', [w.k1, '2026-12-01']), 0);
  await rejects(t.call(u.custA, 'public.owner_generate_month_bills($1, $2::date)', [w.k1, '2026-12-01']), 'NOT_ALLOWED');
  const [bill] = await t.sql(`select closing_balance_paise::int c from public.bills where customer_id = $1 and period_start = '2026-12-01' and period_end = '2026-12-31'`, [w.cust.A]);
  assert.equal(bill.c, Number(await t.call(u.custA, 'public.my_balance($1)', [w.k1])));
});
