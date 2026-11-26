// Ledger correctness: charges happen exactly once, corrections reverse cleanly,
// payments credit once, bills reconcile to the paisa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, oA1;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  oA1 = await w.order(w.cust.A, '2026-12-01', 'lunch');
  await t.call(u.custA, 'public.customer_request_addon($1, $2, 2)', [oA1.id, w.items.egg]);   // 2 x 1500
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${oA1.id}}`, w.staff.delivery]);
  await t.setNow(IST('2026-12-01', '13:20'));
});
after(async () => { await t.close(); });

const balanceA = async () => Number(await t.call(u.custA, 'public.my_balance($1)', [w.k1]));

test('delivery charges tiffin + extras exactly once (offline retries are safe)', async () => {
  await t.call(u.delivery, 'public.staff_mark_delivered($1)', [oA1.id]);
  await t.call(u.delivery, 'public.staff_mark_delivered($1)', [oA1.id]);
  assert.equal(await balanceA(), 11000);
  const kinds = (await t.sql('select kind from public.ledger_entries where order_id = $1 order by kind', [oA1.id])).map((r) => r.kind);
  assert.deepEqual(kinds, ['addon', 'meal']);
});

test('a price change after delivery never changes what was charged', async () => {
  await t.call(u.owner, 'public.owner_set_tiffin_price($1, 9900, $2)', [w.types.veg, '2026-12-01']);
  assert.equal(await balanceA(), 11000);
});

test('owner correction delivered -> not delivered -> delivered keeps the ledger exact', async () => {
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, $3)', [oA1.id, 'not_delivered', 'Customer on leave']);
  assert.equal(await balanceA(), 0);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [oA1.id, 'delivered']);
  assert.equal(await balanceA(), 11000);
  await rejects(t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [oA1.id, 'not_delivered']), 'REASON_REQUIRED');
  const [{ n }] = await t.sql(`select count(*)::int n from public.ledger_entries where order_id = $1 and kind = 'reversal'`, [oA1.id]);
  assert.equal(n, 2);   // meal + addon reversed once, history kept
});

test('customer payment credits only after owner confirmation, and only once', async () => {
  const p = await t.call(u.custA, 'public.customer_submit_payment($1, 11000, $2, $3, $4, $5)', [w.k1, 'UTR555666777', '2026-12-01', 'pay-A-00001', 'Dec part 1']);
  assert.equal(await balanceA(), 11000);
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [p.payment_id]);
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [p.payment_id]);
  assert.equal(await balanceA(), 0);
  await rejects(t.call(u.owner, 'public.owner_reject_payment($1, $2)', [p.payment_id, 'oops']), 'INVALID_STATUS');
});

test('rejected payment: no credit, UTR can be submitted again correctly', async () => {
  const p = await t.call(u.custB, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)', [w.k1, 'UTRBAD00001', '2026-12-01', 'pay-B-00001']);
  await rejects(t.call(u.owner, 'public.owner_reject_payment($1, null)', [p.payment_id]), 'REASON_REQUIRED');
  await t.call(u.owner, 'public.owner_reject_payment($1, $2)', [p.payment_id, 'UTR not found in bank']);
  const again = await t.call(u.custB, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)', [w.k1, 'UTRBAD00001', '2026-12-01', 'pay-B-00002']);
  assert.equal(again.status, 'submitted');
  assert.equal(Number(await t.call(u.custB, 'public.my_balance($1)', [w.k1])), 0);
});

test('owner cash payment is idempotent (double tap records once)', async () => {
  const a = await t.call(u.owner, 'public.owner_record_payment($1, 20000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', 'cash-A-0001']);
  const b = await t.call(u.owner, 'public.owner_record_payment($1, 20000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', 'cash-A-0001']);
  assert.equal(a, b);
  assert.equal(await balanceA(), -20000);    // advance: customer has ₹200 credit
});

test('advance balance is used up by deliveries', async () => {
  const o2 = await w.order(w.cust.A, '2026-12-02', 'lunch');
  await t.setNow(IST('2026-12-02', '13:00'));
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o2.id, 'delivered']);
  assert.equal(await balanceA(), -20000 + 9900);   // Dec 2 order was re-priced to 9900 before its cutoff
});

test('waiver needs a note and step-up; adjustments are signed', async () => {
  await t.call(u.owner, 'public.owner_add_ledger_entry($1, $2, 500, $3, null)', [w.cust.A, 'waiver', 'Late delivery on Dec 2']);
  assert.equal(await balanceA(), -20000 + 9900 - 500);
  await t.call(u.owner, 'public.owner_add_ledger_entry($1, $2, 300, $3, null)', [w.cust.A, 'adjustment', 'Extra salad given']);
  assert.equal(await balanceA(), -20000 + 9900 - 500 + 300);
});

test('closing the kitchen after a late skip refunds the late-skip charge', async () => {
  await t.setNow(IST('2026-12-03', '11:30'));
  const b3 = await w.order(w.cust.B, '2026-12-03', 'lunch');
  await t.as(u.owner, 'update public.customers set late_skip_free_override = 0 where id = $1', [w.cust.B]);
  await t.call(u.custB, 'public.customer_skip_meal($1)', [b3.id]);
  const before = Number(await t.call(u.custB, 'public.my_balance($1)', [w.k1]));
  assert.equal(before, 12000);
  await t.call(u.owner, 'public.owner_add_closure($1, $2::date, $3, $4)', [w.k1, '2026-12-03', 'lunch', 'Gas leak']);
  assert.equal(Number(await t.call(u.custB, 'public.my_balance($1)', [w.k1])), 0);
});

test('monthly bill reconciles with the ledger and is immutable', async () => {
  const billId = await t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, null)', [w.cust.A, '2026-12-01', '2026-12-03']);
  const [bill] = await t.sql('select * from public.bills where id = $1', [billId]);
  assert.equal(Number(bill.closing_balance_paise), await balanceA());
  assert.equal(Number(bill.opening_balance_paise), 0);
  assert.match(bill.bill_no, /^AK-202612-\d{5}$/);
  assert.equal(bill.due_date.toISOString().slice(0, 10), '2026-12-10');   // + 7 grace days
  await rejects(t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, null)', [w.cust.A, '2026-12-01', '2026-12-03']), 'duplicate key');
  await rejects(t.sql('update public.bills set closing_balance_paise = 0'), 'IMMUTABLE');
  await rejects(t.call(u.owner, 'public.owner_generate_bill($1, $2::date, $3::date, null)', [w.cust.A, '2026-12-01', '2026-12-31']), 'INVALID_DATES');
  assert.equal((await t.as(u.custA, 'select count(*)::int n from public.bills'))[0].n, 1);
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.bills'))[0].n, 0);
});
