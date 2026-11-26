// Phase 6: receipts, recurring expenses, budgets, ingredients & prep list, waste,
// profit & loss, daily series, attendance, loyalty. All owner-only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, cat;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  cat = {};
  for (const r of await t.as(u.owner, 'select id, name from public.expense_categories where kitchen_id = $1', [w.k1])) cat[r.name] = r.id;
});
after(async () => { await t.close(); });

const O = (q, p) => t.as(u.owner, q, p);
const put = (user, bucket, name) => t.as(user, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
const canSee = async (user, bucket, name) =>
  (await t.as(user, 'select count(*)::int n from storage.objects where bucket_id = $1 and name = $2', [bucket, name]))[0].n === 1;
const addExpense = (date, category, kind, paise, extra = {}) =>
  O(`insert into public.expenses (kitchen_id, expense_date, category_id, kind, amount_paise, vendor, receipt_path, staff_member_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
  [w.k1, date, cat[category], kind, paise, extra.vendor ?? null, extra.receipt ?? null, extra.staff ?? null]);

test('receipts bucket: owner only, own kitchen, <kitchen>/<uuid>.jpg', async () => {
  const name = `${w.k1}/aaaaaaaa-1111-4111-8111-111111111111.jpg`;
  await put(u.owner, 'receipts', name);
  for (const user of [u.kitchen, u.delivery, u.custA, u.owner2]) {
    await rejects(put(user, 'receipts', `${w.k1}/bbbbbbbb-1111-4111-8111-111111111111.jpg`), 'row-level security');
  }
  await rejects(put(u.owner, 'receipts', `${w.k2}/cccccccc-1111-4111-8111-111111111111.jpg`), 'row-level security');
  await rejects(put(u.owner, 'receipts', `${w.k1}/receipt-photo.jpg`), 'row-level security');       // must be a uuid name
  await rejects(put(u.owner, 'receipts', `${w.k1}/x/dddddddd-1111-4111-8111-111111111111.jpg`), 'row-level security');
  assert.equal(await canSee(u.owner, 'receipts', name), true);
  for (const user of [u.kitchen, u.delivery, u.custA, u.owner2, null]) assert.equal(await canSee(user, 'receipts', name), false);

  // expense rows may only point at a receipt in their own kitchen's folder
  await addExpense('2026-12-01', 'Vegetables', 'running', 50000, { vendor: 'Ramesh', receipt: name });
  await rejects(addExpense('2026-12-01', 'Vegetables', 'running', 100, { receipt: `${w.k2}/aaaaaaaa-1111-4111-8111-111111111111.jpg` }), 'receipt_in_kitchen');
  await rejects(addExpense('2026-12-01', 'Vegetables', 'running', 100, { receipt: '../../etc/passwd' }), 'receipt_in_kitchen');
});

test('expenses stay private to the owner; salary can point at a staff member of this kitchen only', async () => {
  await addExpense('2026-12-01', 'Staff salary', 'running', 600000, { staff: w.staff.delivery });
  const k2staff = (await t.sql(`select id from public.staff_members where kitchen_id = $1 limit 1`, [w.k2]))[0].id;
  await rejects(addExpense('2026-12-01', 'Staff salary', 'running', 600000, { staff: k2staff }), 'foreign key');
  for (const user of [u.kitchen, u.delivery, u.custA, u.owner2]) {
    assert.equal((await t.as(user, 'select count(*)::int n from public.expenses'))[0].n, 0, `${user.label} sees expenses`);
  }
});

test('recurring expenses: reminder when due, one tap records it, due day kept', async () => {
  const [{ id: rent }] = await O(`insert into public.recurring_expenses (kitchen_id, title, category_id, amount_paise, every, next_due)
                                  values ($1, 'Kitchen rent', $2, 500000, 'monthly', '2026-11-28') returning id`, [w.k1, cat.Utilities]);
  const [{ id: gas }] = await O(`insert into public.recurring_expenses (kitchen_id, title, category_id, amount_paise, every, next_due)
                                 values ($1, 'Gas cylinder', $2, 110000, 'weekly', '2026-12-05') returning id`, [w.k1, cat['Gas & Fuel']]);
  await rejects(t.as(u.owner2, `insert into public.recurring_expenses (kitchen_id, title, category_id, amount_paise, every, next_due)
                                values ($1, 'x', $2, 1, 'weekly', '2026-12-01')`, [w.k1, cat.Utilities]), 'row-level security');
  await rejects(t.as(u.owner2, `insert into public.recurring_expenses (kitchen_id, title, category_id, amount_paise, every, next_due)
                                values ($1, 'x', $2, 1, 'weekly', '2026-12-01')`, [w.k2, cat.Utilities]), 'foreign key');   // k1 category in k2

  await t.sql('select app.run_finance_jobs()');
  await t.sql('select app.run_finance_jobs()');   // same day again: no duplicate
  const due = await t.as(u.owner, `select title, body from public.notifications where kind = 'expense_due'`);
  assert.deepEqual(due, [{ title: 'Kitchen rent is due', body: '₹5000 · tap Money › Expenses to record it.' }]);   // gas not due yet

  for (const user of [u.owner2, u.custA, u.kitchen]) await rejects(t.call(user, 'public.owner_record_recurring($1)', [rent]), 'NOT_ALLOWED');
  const exp = await t.call(u.owner, 'public.owner_record_recurring($1)', [rent]);
  const [e] = await O('select expense_date, amount_paise, note, kind, category_id from public.expenses where id = $1', [exp]);
  assert.equal(e.expense_date.toISOString().slice(0, 10), '2026-12-01');
  assert.equal(Number(e.amount_paise), 500000);
  assert.equal(e.note, 'Kitchen rent');
  assert.equal(e.category_id, cat.Utilities);
  const next = async (id) => (await O('select next_due::text d from public.recurring_expenses where id = $1', [id]))[0].d;
  assert.equal(await next(rent), '2026-12-28');                       // 28th stays the 28th
  await t.call(u.owner, 'public.owner_record_recurring($1)', [gas]); // paid early
  assert.equal(await next(gas), '2026-12-12');
  await O('update public.recurring_expenses set active = false where id = $1', [gas]);
  await rejects(t.call(u.owner, 'public.owner_record_recurring($1)', [gas]), 'INVALID_STATUS');
});

test('budgets, ingredients and item ingredients are owner-only and kitchen-bound', async () => {
  await O('insert into public.budgets (kitchen_id, category_id, amount_paise) values ($1, $2, 300000)', [w.k1, cat.Vegetables]);
  await rejects(t.as(u.owner2, 'insert into public.budgets (kitchen_id, category_id, amount_paise) values ($1, $2, 1)', [w.k1, cat.Dairy]), 'row-level security');
  await rejects(t.as(u.custA, 'insert into public.budgets (kitchen_id, category_id, amount_paise) values ($1, $2, 1)', [w.k1, cat.Dairy]), 'row-level security|permission');
  const [{ id: atta }] = await O(`insert into public.ingredients (kitchen_id, name, unit) values ($1, 'Atta', 'kg') returning id`, [w.k1]);
  const [{ id: eggs }] = await O(`insert into public.ingredients (kitchen_id, name, unit) values ($1, 'Eggs', 'pcs') returning id`, [w.k1]);
  await rejects(O(`insert into public.ingredients (kitchen_id, name, unit) values ($1, ' atta ', 'kg')`, [w.k1]), 'duplicate|unique');
  await O('insert into public.item_ingredients (kitchen_id, item_id, ingredient_id, qty) values ($1, $2, $3, 0.03)', [w.k1, w.items.roti, atta]);
  await O('insert into public.item_ingredients (kitchen_id, item_id, ingredient_id, qty) values ($1, $2, $3, 1)', [w.k1, w.items.egg, eggs]);
  const [{ id: k2ing }] = await t.as(u.owner2, `insert into public.ingredients (kitchen_id, name, unit) values ($1, 'Rice', 'kg') returning id`, [w.k2]);
  await rejects(O('insert into public.item_ingredients (kitchen_id, item_id, ingredient_id, qty) values ($1, $2, $3, 1)', [w.k1, w.items.roti, k2ing]), 'foreign key');
  for (const user of [u.kitchen, u.custA, u.owner2]) {
    for (const table of ['budgets', 'ingredients', 'item_ingredients', 'recurring_expenses']) {
      const rows = await t.as(user, `select count(*)::int n from public.${table} where kitchen_id = $1`, [w.k1]);
      assert.equal(rows[0].n, 0, `${user.label} reads ${table}`);
    }
  }
});

test('prep list: items and ingredients to cook today, from tiffins + accepted extras', async () => {
  // Dec 1 scheduled: Priya veg lunch (4 roti), Anil non-veg lunch (no items), Anil veg dinner (4 roti + 1 egg extra)
  const rows = await t.as(u.owner, 'select kind, name, unit, qty from public.owner_prep_totals($1, $2::date)', [w.k1, '2026-12-01']);
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.unit, Number(r.qty)]), [
    ['ingredient', 'Atta', 'kg', 0.24], ['ingredient', 'Eggs', 'pcs', 1],
    ['item', 'Egg', 'piece', 1], ['item', 'Roti', 'piece', 8],
  ]);
  const skipped = await w.order(w.cust.B, '2026-12-01', 'dinner');
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [skipped.id, 'skipped']);
  const after = await t.as(u.owner, 'select name, qty from public.owner_prep_totals($1, $2::date) where kind = $3', [w.k1, '2026-12-01', 'item']);
  assert.deepEqual(after.map((r) => [r.name, Number(r.qty)]), [['Roti', 4]]);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [skipped.id, 'scheduled']);
  for (const user of [u.owner2, u.kitchen, u.custA]) {
    await rejects(t.as(user, 'select * from public.owner_prep_totals($1, $2::date)', [w.k1, '2026-12-01']), 'NOT_ALLOWED');
  }
});

test('waste entries: owner adds and deletes; nobody else', async () => {
  const [{ id }] = await O(`insert into public.waste_entries (kitchen_id, entry_date, meal_slot, tiffins, note) values ($1, '2026-12-01', 'lunch', 2, 'rain') returning id`, [w.k1]);
  await rejects(t.as(u.kitchen, `insert into public.waste_entries (kitchen_id, entry_date, meal_slot, tiffins) values ($1, '2026-12-01', 'lunch', 1)`, [w.k1]), 'row-level security');
  await rejects(O(`insert into public.waste_entries (kitchen_id, entry_date, meal_slot, tiffins) values ($1, '2026-12-01', 'lunch', 0)`, [w.k1]), 'check');
  await O(`insert into public.waste_entries (kitchen_id, entry_date, meal_slot, tiffins) values ($1, '2026-12-01', 'dinner', 1)`, [w.k1]);
  await O('delete from public.waste_entries where id = $1', [id]);
  assert.equal((await O('select sum(tiffins)::int n from public.waste_entries where kitchen_id = $1', [w.k1]))[0].n, 1);
});

test('profit & loss for a day: billed, received, expenses, per meal, categories, tiffin types, payback', async () => {
  await t.setNow(IST('2026-12-01', '21:00'));
  for (const [c, slot] of [[w.cust.A, 'lunch'], [w.cust.B, 'lunch'], [w.cust.B, 'dinner']]) {
    const o = await w.order(c, '2026-12-01', slot);
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  }
  await t.call(u.owner, 'public.owner_record_payment($1, 5000, $2, null, $3, null, $4)', [w.cust.A, 'cash', '2026-12-01', 'pl-pay-0001']);
  await addExpense('2026-12-01', 'Tiffin boxes', 'investment', 300000);

  const pl = await t.call(u.owner, 'public.owner_profit_loss($1, $2::date, $3::date)', [w.k1, '2026-12-01', '2026-12-01']);
  const running = 50000 + 600000 + 500000 + 110000;            // vegetables, salary, rent, gas
  const billed = 8000 + 12000 + 8000 + 1500;                    // veg + non-veg + veg + egg extra
  assert.equal(pl.billed_paise, billed);
  assert.equal(pl.received_paise, 5000);
  assert.equal(pl.running_expenses_paise, running);
  assert.equal(pl.investments_paise, 300000);
  assert.equal(pl.profit_paise, billed - running);
  assert.equal(pl.meals_delivered, 3);
  assert.equal(pl.cost_per_meal_paise, Math.round(running / 3));
  assert.equal(pl.billed_per_meal_paise, Math.round(billed / 3));
  assert.equal(pl.waste_tiffins, 1);
  assert.equal(pl.investments_all_time_paise, 300000);
  assert.equal(pl.payback_percent, 0);                          // a loss so far: clamped at 0
  const veg = pl.by_category.find((c) => c.name === 'Vegetables');
  assert.deepEqual(veg, { name: 'Vegetables', kind: 'running', amount_paise: 50000, budget_paise: 300000 });
  assert.equal(pl.by_category[0].name, 'Staff salary');          // biggest first
  assert.deepEqual(pl.by_tiffin_type, [
    { name: 'Veg Standard', meals: 2, billed_paise: 16000 }, { name: 'Non-Veg', meals: 1, billed_paise: 12000 },
  ]);

  await rejects(t.call(u.owner, 'public.owner_profit_loss($1, $2::date, $3::date)', [w.k1, '2026-12-02', '2026-12-01']), 'INVALID_DATES');
  await rejects(t.call(u.owner, 'public.owner_profit_loss($1, $2::date, $3::date)', [w.k1, '2025-01-01', '2026-12-01']), 'INVALID_DATES');
  for (const user of [u.owner2, u.custA, u.kitchen, u.delivery]) {
    await rejects(t.call(user, 'public.owner_profit_loss($1, $2::date, $3::date)', [w.k1, '2026-12-01', '2026-12-01']), 'NOT_ALLOWED');
  }
  // the other kitchen's numbers are untouched by ours
  const pl2 = await t.call(u.owner2, 'public.owner_profit_loss($1, $2::date, $3::date)', [w.k2, '2026-12-01', '2026-12-01']);
  assert.equal(pl2.running_expenses_paise, 0);
  assert.equal(pl2.billed_paise, 0);
});

test('daily series: one row per day with meals, billed and expenses', async () => {
  const rows = await t.as(u.owner, 'select day::text, meals, billed_paise, expenses_paise from public.owner_daily_series($1, $2::date, $3::date)',
    [w.k1, '2026-11-30', '2026-12-02']);
  assert.deepEqual(rows.map((r) => [r.day, r.meals, Number(r.billed_paise), Number(r.expenses_paise)]), [
    ['2026-11-30', 0, 0, 0],
    ['2026-12-01', 3, 29500, 50000 + 600000 + 500000 + 110000 + 300000],
    ['2026-12-02', 0, 0, 0],
  ]);
  await rejects(t.as(u.custA, 'select * from public.owner_daily_series($1, $2::date, $3::date)', [w.k1, '2026-12-01', '2026-12-02']), 'NOT_ALLOWED');
});

test('attendance: shifts and minutes per staff member (owner not listed)', async () => {
  await t.setNow(IST('2026-12-02', '10:00'));
  await t.call(u.delivery, 'public.staff_check_in($1)', [w.k1]);
  await t.setNow(IST('2026-12-02', '12:30'));
  await t.call(u.delivery, 'public.staff_check_out($1)', [w.k1]);
  await t.call(u.kitchen, 'public.staff_check_in($1)', [w.k1]);
  await t.setNow(IST('2026-12-02', '13:00'));   // still open: counted up to now
  const rows = await t.as(u.owner, 'select display_name, shifts, minutes from public.owner_attendance($1, $2::date, $3::date)',
    [w.k1, '2026-12-01', '2026-12-31']);
  assert.deepEqual(rows, [
    { display_name: 'Meena', shifts: 1, minutes: 30 },
    { display_name: 'Ravi', shifts: 1, minutes: 150 },
    { display_name: 'Sunil', shifts: 0, minutes: 0 },
  ]);
  await rejects(t.as(u.delivery, 'select * from public.owner_attendance($1, $2::date, $3::date)', [w.k1, '2026-12-01', '2026-12-31']), 'NOT_ALLOWED');
});

test('loyalty: off by default; when on, one reward per milestone, notified, immutable', async () => {
  const deliverA = async (date) => {
    const o = await w.order(w.cust.A, date, 'lunch');
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
    return o;
  };
  await deliverA('2026-12-02');   // Priya: 2 delivered, loyalty is off
  assert.equal((await t.sql('select count(*)::int n from public.loyalty_rewards'))[0].n, 0);

  const setLoyalty = (user, opts) => t.call(user, 'public.owner_set_loyalty($1, $2, $3, $4, $5)', [w.k1, true, 5, 2000, 'free salad'], opts);
  await rejects(t.as(u.owner, `insert into public.loyalty_rules (kitchen_id, active, every_n_meals) values ($1, true, 5)`, [w.k1]), 'permission');
  await rejects(setLoyalty(u.custA), 'NOT_ALLOWED');
  await rejects(setLoyalty(u.owner2), 'NOT_ALLOWED');
  await rejects(setLoyalty(u.owner, { mfaAgoSec: 3600 }), 'STEP_UP_REQUIRED');      // authenticator code older than 10 min
  await rejects(t.call(u.owner, 'public.owner_set_loyalty($1, true, 3, 2000, $2)', [w.k1, 'x']), 'INVALID_SETTING');
  await rejects(t.call(u.owner, 'public.owner_set_loyalty($1, true, 5, 99999999, $2)', [w.k1, 'x']), 'INVALID_AMOUNT');
  await setLoyalty(u.owner);
  await setLoyalty(u.owner);   // saving again updates the same row
  assert.equal((await O('select count(*)::int n from public.loyalty_rules')) [0].n, 1);
  await deliverA('2026-12-03');
  await deliverA('2026-12-04');
  const fifth = await deliverA('2026-12-05');   // 5th delivered meal -> reward

  const [r] = await t.as(u.custA, 'select milestone, ledger_entry_id from public.loyalty_rewards');
  assert.equal(r.milestone, 5);
  const [le] = await t.sql('select kind, amount_paise, order_id, note from public.ledger_entries where id = $1', [r.ledger_entry_id]);
  assert.deepEqual({ ...le, amount_paise: Number(le.amount_paise) },
    { kind: 'discount', amount_paise: -2000, order_id: fifth.id, note: 'Loyalty reward: 5 meals (free salad)' });
  const [n] = await t.as(u.custA, `select title, body from public.notifications where kind = 'loyalty_reward'`);
  assert.deepEqual(n, { title: 'Thank you for 5 meals!', body: 'You get a free salad on us: ₹20 taken off your bill.' });
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.loyalty_rewards'))[0].n, 0);

  // re-marking the same order (delivered -> scheduled -> delivered) does not pay twice
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [fifth.id, 'scheduled']);
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [fifth.id, 'delivered']);
  assert.equal((await t.sql('select count(*)::int n from public.loyalty_rewards'))[0].n, 1);
  assert.equal((await t.sql(`select count(*)::int n from public.ledger_entries where note like 'Loyalty%'`))[0].n, 1);

  await rejects(t.sql('update public.loyalty_rewards set milestone = 10'), 'IMMUTABLE');
  await rejects(t.sql('delete from public.loyalty_rewards'), 'IMMUTABLE');
  await rejects(t.as(u.owner, 'delete from public.loyalty_rewards'), 'permission|IMMUTABLE');
});

test('receipts are kept: the media clean-up never lists them, however old', async () => {
  await t.setNow('2030-01-01T00:00:00Z');
  const rows = await t.asService('select bucket_id from public.media_expired(1000)');
  assert.ok(!rows.some((r) => r.bucket_id === 'receipts'));
  assert.equal((await t.sql(`select count(*)::int n from storage.objects where bucket_id = 'receipts'`))[0].n, 1);
});

test('F31: directions and packing photos: owner uploads, staff of this kitchen see them, customers do not', async () => {
  await t.setNow(IST('2026-12-07', '09:00'));
  const dir = `${w.k1}/ward5-entrance.jpg`;
  const pack = `${w.k1}/veg-packing.jpg`;
  await put(u.owner, 'kitchen-media', dir);
  await put(u.owner, 'kitchen-media', pack);
  await rejects(put(u.kitchen, 'kitchen-media', `${w.k1}/staff-upload.jpg`), 'row-level security');
  await O('update public.location_nodes set directions_photo_path = $1 where id = $2', [dir, w.ward5]);
  await rejects(O('update public.location_nodes set directions_photo_path = $1 where id = $2', [`${w.k2}/x.jpg`, w.ward5]), 'check');
  await O(`insert into public.packing_instructions (tiffin_type_id, kitchen_id, instructions, photo_path) values ($1, $2, 'Dal in the round box', $3)`,
    [w.types.veg, w.k1, pack]);

  const o = await w.order(w.cust.A, '2026-12-07', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${o.id}}`, w.staff.delivery]);
  const [task] = await t.as(u.delivery, `select location_path, location_photo_path from public.staff_my_tasks($1, $2::date, 'lunch') where order_id = $3`,
    [w.k1, '2026-12-07', o.id]);
  assert.deepEqual(task, { location_path: 'City Hospital > Ward 5', location_photo_path: dir });
  assert.equal((await t.as(u.kitchen, 'select photo_path from public.packing_instructions where tiffin_type_id = $1', [w.types.veg]))[0].photo_path, pack);
  for (const user of [u.delivery, u.kitchen]) {
    assert.equal(await canSee(user, 'kitchen-media', dir), true);
    assert.equal(await canSee(user, 'kitchen-media', pack), true);
  }
  for (const user of [u.owner2, u.stranger, null]) assert.equal(await canSee(user, 'kitchen-media', dir), false);
});
