// Phase 6: insights (suggestions) over ~7 weeks of simulated history.
// Planted patterns, each meant to trigger exactly one rule:
//   - Priya skips every Friday lunch                       -> "Friday lunch: N% skipped"
//   - Anil stops ordering from 7 Jan, never pays           -> churn + old dues
//   - Vegetables ₹1000 (Dec) -> ₹1500 (Jan), budget ₹1200  -> spending up, over budget, cost per meal rising
//   - 10 tiffins wasted in Jan                             -> extra food
//   - Tiffin boxes investment                              -> payback
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, cat;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  cat = {};
  for (const r of await t.as(u.owner, 'select id, name from public.expense_categories where kitchen_id = $1', [w.k1])) cat[r.name] = r.id;
});
after(async () => { await t.close(); });

const O = (q, p) => t.as(u.owner, q, p);
const insights = async () => t.as(u.owner, 'select severity, title, detail from public.owner_insights($1)', [w.k1]);
const addExpense = (date, category, kind, paise) =>
  O(`insert into public.expenses (kitchen_id, expense_date, category_id, kind, amount_paise) values ($1, $2, $3, $4, $5)`,
    [w.k1, date, cat[category], kind, paise]);

test('a new kitchen gets no suggestions (no false alarms)', async () => {
  assert.deepEqual(await insights(), []);
  for (const user of [u.owner2, u.custA, u.kitchen]) await rejects(t.as(user, 'select * from public.owner_insights($1)', [w.k1]), 'NOT_ALLOWED');
});

test('seven weeks of history produce the expected suggestions, with numbers', async () => {
  await O('insert into public.budgets (kitchen_id, category_id, amount_paise) values ($1, $2, 120000)', [w.k1, cat.Vegetables]);
  for (let d = '2026-12-01'; d <= '2027-01-20'; d = addDays(d, 1)) {
    await t.setNow(IST(d, '08:00'));
    await t.sql('select app.generate_orders_all()');
    if (d === '2026-12-01') await addExpense(d, 'Tiffin boxes', 'investment', 500000);
    if (d === '2026-12-10') await addExpense(d, 'Vegetables', 'running', 100000);
    if (d === '2027-01-10') await addExpense(d, 'Vegetables', 'running', 150000);
    if (d === '2027-01-05') await t.call(u.owner, 'public.owner_record_payment($1, 50000, $2, null, $3, null, $4)', [w.cust.A, 'upi', d, 'ins-pay-0001']);
    if (d === '2027-01-15') await O(`insert into public.waste_entries (kitchen_id, entry_date, meal_slot, tiffins) values ($1, $2, 'lunch', 10)`, [w.k1, d]);
    if (d === '2027-01-20') break;   // "today": nothing delivered yet
    const friday = new Date(`${d}T00:00:00Z`).getUTCDay() === 5;
    const orders = await t.sql(`select id, customer_id, meal_slot from public.orders where kitchen_id = $1 and order_date = $2 and status = 'scheduled'`, [w.k1, d]);
    for (const o of orders) {
      const skip = (o.customer_id === w.cust.A && o.meal_slot === 'lunch' && friday) || (o.customer_id === w.cust.B && d >= '2027-01-07');
      await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, skip ? 'skipped' : 'delivered']);
    }
  }

  const rows = await insights();
  const titles = rows.map((r) => r.title);
  const find = (re) => {
    const r = rows.find((x) => re.test(x.title));
    assert.ok(r, `missing insight ${re} in ${JSON.stringify(titles)}`);
    return r;
  };

  const veg = find(/^Vegetables spending up 50%$/);
  assert.equal(veg.severity, 'warn');
  assert.match(veg.detail, /^₹1500 so far this month vs ₹1000 in the same days last month, while meals changed -\d+%\. Check prices or quantities\.$/);

  assert.equal(find(/^Cost per meal is rising$/).severity, 'warn');

  const fri = find(/^Friday lunch: \d+% skipped$/);
  assert.equal(fri.severity, 'info');
  assert.equal(fri.detail, 'About 1 fewer tiffin is needed on a typical Friday. Consider cooking a little less.');
  // only Friday lunch crosses 20% (other days have at most 2 of ~14 skipped)
  assert.equal(rows.filter((r) => /skipped$/.test(r.title)).length, 1);

  const waste = find(/^Extra food: \d+% of meals$/);
  assert.match(waste.detail, /^10 tiffins were left over in the last 30 days/);

  const dues = find(/^1 customer with no payment for 30\+ days$/);
  assert.match(dues.detail, /: Anil\.$/);                      // Priya paid on 5 Jan

  const budget = find(/^Vegetables is over budget$/);
  assert.equal(budget.detail, '₹1500 spent of ₹1200 this month.');

  find(/^\d+ box(es)? out for 5\+ days$/);                       // no box was ever collected in this simulation

  const churn = find(/^1 customer ordering much less$/);
  assert.match(churn.detail, /: Anil\. A friendly message may help\.$/);

  const pl = await t.call(u.owner, 'public.owner_profit_loss($1, $2::date, $3::date)', [w.k1, '2027-01-01', '2027-01-20']);
  const payback = find(/% of your investments recovered$/);
  assert.equal(payback.title, `${pl.payback_percent}% of your investments recovered`);
  assert.equal(pl.investments_all_time_paise, 500000);
  assert.ok(pl.profit_since_first_investment_paise > 0);
  assert.equal(payback.detail, `Investments so far: ₹5000. Profit since the first one: ₹${pl.profit_since_first_investment_paise / 100}.`);

  // every insight is one of the known shapes; nothing unexpected
  assert.equal(rows.length, 9, JSON.stringify(titles));
});

test('suggestions come back in the owner\'s language (every line fully translated)', async () => {
  const en = await insights();
  assert.ok(en.length >= 5, JSON.stringify(en));
  for (const lang of ['mr', 'hi']) {
    await t.call(u.owner, 'public.set_my_language($1)', [lang]);
    const tr = await insights();
    assert.equal(tr.length, en.length);
    tr.forEach((r, i) => {
      assert.equal(r.severity, en[i].severity);
      for (const k of ['title', 'detail']) {
        assert.match(r[k], /[ऀ-ॿ]/, `${lang} not translated: ${en[i][k]}`);
        // names and amounts are values; any other English word means a missing template
        const left = r[k].replace(/\b(Vegetables|Anil|Priya|Gas|Rent|Salary|Milk)\b/g, '').match(/[A-Za-z]{3,}/g);
        assert.equal(left, null, `${lang} leftover English in: ${r[k]}`);
      }
    });
  }
  await t.call(u.owner, 'public.set_my_language($1)', ['en']);
  assert.deepEqual(await insights(), en);
});

test('the other kitchen sees nothing of this history', async () => {
  const rows = await t.as(u.owner2, 'select title from public.owner_insights($1)', [w.k2]);
  assert.ok(!rows.some((r) => /Vegetables|Anil|Priya/.test(r.title)), JSON.stringify(rows));
});
