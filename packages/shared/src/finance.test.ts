import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthlyReportHtml, parseQuickExpense, toCsv, type ProfitLoss } from './finance.ts';

const CATS = ['Vegetables', 'Grains & Flour', 'Oil & Spices', 'Dairy', 'Meat & Eggs', 'Gas & Fuel', 'Packaging', 'Transport',
  'Staff salary', 'Utilities', 'Other', 'Tiffin boxes', 'Kitchen equipment', 'Sweets'].map((name) => ({ id: `id-${name}`, name }));

test('quick expense: amount, category, vendor and note from everyday phrases', () => {
  assert.deepEqual(parseQuickExpense('500 vegetables from Ramesh', CATS),
    { amountPaise: 50000, categoryId: 'id-Vegetables', vendor: 'Ramesh', note: 'vegetables' });
  assert.deepEqual(parseQuickExpense('gas cylinder 1100', CATS),
    { amountPaise: 110000, categoryId: 'id-Gas & Fuel', vendor: null, note: 'gas cylinder' });
  assert.deepEqual(parseQuickExpense('paid ₹1,250.50 to Raju Dairy for curd', CATS),
    { amountPaise: 125050, categoryId: 'id-Dairy', vendor: 'Raju Dairy', note: 'curd' });
  assert.deepEqual(parseQuickExpense('2 kg atta 300', CATS),
    { amountPaise: 30000, categoryId: 'id-Grains & Flour', vendor: null, note: '2 kg atta' });   // "2 kg" is a quantity
  assert.equal(parseQuickExpense('Sweets 250 at Chitale', CATS)?.categoryId, 'id-Sweets');      // owner's own category
  assert.equal(parseQuickExpense('Rs 80 something', CATS)?.categoryId, null);                   // owner chooses
});

test('quick expense in Marathi and Hindi (typed or said with the keyboard mic)', () => {
  assert.deepEqual(parseQuickExpense('500 भाजी रमेशकडून', CATS),
    { amountPaise: 50000, categoryId: 'id-Vegetables', vendor: 'रमेश', note: 'भाजी' });
  assert.deepEqual(parseQuickExpense('२ किलो कांदे ८०', CATS),               // Devanagari digits; "2 किलो" is a quantity
    { amountPaise: 8000, categoryId: 'id-Vegetables', vendor: null, note: '2 किलो कांदे' });
  assert.deepEqual(parseQuickExpense('रमेश से 500 की सब्ज़ी', CATS),
    { amountPaise: 50000, categoryId: 'id-Vegetables', vendor: 'रमेश', note: 'सब्ज़ी' });
  assert.deepEqual(parseQuickExpense('दूध 60 रुपये', CATS), { amountPaise: 6000, categoryId: 'id-Dairy', vendor: null, note: 'दूध' });
  assert.deepEqual(parseQuickExpense('गॅस सिलेंडर रु. 1100 सुरेश यांच्याकडून', CATS),
    { amountPaise: 110000, categoryId: 'id-Gas & Fuel', vendor: 'सुरेश', note: 'गॅस सिलेंडर' });
  assert.equal(parseQuickExpense('पगार 5000', CATS)?.categoryId, 'id-Staff salary');
  assert.equal(parseQuickExpense('बिजली का बिल 1200', CATS)?.categoryId, 'id-Utilities');
  assert.deepEqual(parseQuickExpense('300 sabzi Ramesh se', CATS),
    { amountPaise: 30000, categoryId: 'id-Vegetables', vendor: 'Ramesh', note: 'sabzi' });
  // the owner's own category, named in Marathi
  const mine = [...CATS, { id: 'id-mithai', name: 'मिठाई' }];
  assert.deepEqual(parseQuickExpense('250 मिठाई चितळेकडून', mine), { amountPaise: 25000, categoryId: 'id-mithai', vendor: 'चितळे', note: 'मिठाई' });
  // a word that merely contains a keyword is not that keyword
  assert.equal(parseQuickExpense('तेलगू पुस्तक 200', CATS)?.categoryId, null);
  assert.equal(parseQuickExpense('२ किलो ३००', CATS)?.amountPaise, 30000);   // the quantity is never the amount
});

test('quick expense: no amount or two amounts -> null (owner types it instead)', () => {
  assert.equal(parseQuickExpense('vegetables from Ramesh', CATS), null);
  assert.equal(parseQuickExpense('10 eggs 60', CATS), null);
  assert.equal(parseQuickExpense('', CATS), null);
  assert.equal(parseQuickExpense('0 milk', CATS), null);
  assert.equal(parseQuickExpense('9999999999 milk', CATS), null);
});

test('CSV: quotes, BOM, and formulas neutralised', () => {
  const csv = toCsv([['Date', 'Vendor', 'Amount'], ['2026-12-01', 'Shah, "Big" Mart', 500.5], ['2026-12-02', '=HYPERLINK("http://x")', -3],
    ['2026-12-03', '+91 phone', null], ['2026-12-04', '@SUM(A1)', 0], ['x', '-cmd', NaN]]);
  const lines = csv.slice(1).split('\r\n');
  assert.ok(csv.startsWith('﻿'));
  assert.equal(lines[1], '2026-12-01,"Shah, ""Big"" Mart",500.5');
  assert.equal(lines[2], `2026-12-02,"'=HYPERLINK(""http://x"")",-3`);   // numbers stay numbers, text formulas get '
  assert.equal(lines[3], "2026-12-03,'+91 phone,");
  assert.equal(lines[4], "2026-12-04,'@SUM(A1),0");
  assert.equal(lines[5], "x,'-cmd,");
});

test('monthly report: all numbers present and names escaped', () => {
  const pl: ProfitLoss = {
    from: '2026-12-01', to: '2026-12-31', billed_paise: 1200000, received_paise: 1000000, running_expenses_paise: 700000,
    investments_paise: 300000, profit_paise: 500000, meals_delivered: 150, cost_per_meal_paise: 4667, billed_per_meal_paise: 8000,
    waste_tiffins: 4, investments_all_time_paise: 300000, profit_since_first_investment_paise: 500000, payback_percent: 100,
    by_category: [{ name: '<script>x</script>', kind: 'running', amount_paise: 700000, budget_paise: 600000 }],
    by_tiffin_type: [{ name: 'Veg', meals: 150, billed_paise: 1200000 }],
  };
  const html = monthlyReportHtml("Amruta's Kitchen", pl, [{ severity: 'warn', title: 'Veg <b>up</b>', detail: 'x' }]);
  for (const s of ['₹12,000', '₹10,000', '₹7,000', '₹5,000', '₹46.67', '150', '100%', '₹6,000']) assert.ok(html.includes(s), s);
  assert.ok(!html.includes('<script>x'));
  assert.ok(!html.includes('<b>up'));
  assert.ok(html.includes('Amruta&#39;s Kitchen'));
});
