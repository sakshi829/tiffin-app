// Phase 8b: "request to join" (F15) and the store-review demo kitchen (F43).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const ask = (user, name = 'Neha', phone = '98200 12345') =>
  t.call(user, 'public.customer_request_to_join($1, $2, $3, $4, $5)', [w.k1, name, phone, 'Ward 5', 'Lunch on weekdays']);
const mode = (m) => t.call(u.owner, `public.owner_update_settings($1, $2::jsonb)`, [w.k1, JSON.stringify({ signup_mode: m })]);

test('invite-only kitchens refuse join requests', async () => {
  await rejects(ask(u.stranger), 'NOT_ALLOWED');
  const [info] = await t.as(u.stranger, 'select * from public.kitchen_join_info($1)', [w.k1]);
  assert.deepEqual(info, { name: "Amruta's Kitchen", signup_mode: 'invite_only', my_request_status: null });
  await rejects(t.as(null, 'select * from public.kitchen_join_info($1)', [w.k1]), 'permission denied');
});

test('request to join: one pending request, private to the person and the owner, approved by the owner', async () => {
  await mode('request_to_join');
  await rejects(ask(u.stranger, 'Neha', 'call me'), 'INVALID_REQUEST');
  assert.deepEqual(await ask(u.stranger), { status: 'pending' });
  assert.deepEqual(await ask(u.stranger), { status: 'pending' });                       // asking again adds nothing
  assert.equal((await t.sql('select count(*)::int n from public.join_requests'))[0].n, 1);
  assert.equal((await t.as(u.owner, `select title from public.notifications where kind = 'join_request'`)).length, 1);
  const [req] = await t.as(u.stranger, 'select id, status, full_name from public.join_requests');
  assert.equal(req.full_name, 'Neha');
  for (const other of [u.custA, u.delivery, u.owner2]) {
    assert.equal((await t.as(other, 'select id from public.join_requests')).length, 0);
  }
  await rejects(ask(u.custA), 'ALREADY_LINKED');
  await rejects(ask(u.delivery), 'ALREADY_LINKED');
  await rejects(t.call(u.owner2, 'public.owner_decide_join($1, true)', [req.id]), 'NOT_ALLOWED');
  await rejects(t.call(u.stranger, 'public.owner_decide_join($1, true)', [req.id]), 'NOT_ALLOWED');
  const customerId = await t.call(u.owner, 'public.owner_decide_join($1, true)', [req.id]);
  const [c] = await t.sql('select full_name, phone, default_location_text, user_id, status from public.customers where id = $1', [customerId]);
  assert.deepEqual(c, { full_name: 'Neha', phone: '98200 12345', default_location_text: 'Ward 5', user_id: u.stranger.id, status: 'active' });
  assert.equal((await t.as(u.stranger, `select title from public.notifications where kind = 'join_decision'`))[0].title, "Welcome to Amruta's Kitchen");
  await rejects(t.call(u.owner, 'public.owner_decide_join($1, false)', [req.id]), 'INVALID_STATUS');
  assert.equal((await t.as(u.stranger, 'select * from public.kitchen_join_info($1)', [w.k1]))[0].my_request_status, 'approved');
});

test('declined requests tell the person; "open" kitchens approve at once', async () => {
  const p1 = await t.createUser('p1');
  await ask(p1, 'Ravi K', '9876500000');
  const [req] = await t.as(u.owner, `select id from public.join_requests where status = 'pending'`);
  assert.equal(await t.call(u.owner, 'public.owner_decide_join($1, false)', [req.id]), null);
  assert.match((await t.as(p1, `select body from public.notifications where kind = 'join_decision'`))[0].body, /cannot take new customers/);
  await mode('open');
  const p2 = await t.createUser('p2');
  assert.deepEqual(await ask(p2, 'Sara', '9876511111'), { status: 'approved' });
  assert.equal((await t.sql('select count(*)::int n from public.customers where user_id = $1 and kitchen_id = $2', [p2.id, w.k1]))[0].n, 1);
  // limited: 3 requests a day per person
  await mode('request_to_join');
  const p3 = await t.createUser('p3');
  const k2ask = (n) => t.call(p3, 'public.customer_request_to_join($1, $2, $3, null, null)', [w.k1, n, '9876522222']);
  await k2ask('A');
  const [mine] = await t.as(p3, `select id from public.join_requests where status = 'pending'`);
  await t.call(u.owner, 'public.owner_decide_join($1, false)', [mine.id]);
  await k2ask('B');
  const [mine2] = await t.as(p3, `select id from public.join_requests where status = 'pending'`);
  await t.call(u.owner, 'public.owner_decide_join($1, false)', [mine2.id]);
  await k2ask('C');
  const [mine3] = await t.as(p3, `select id from public.join_requests where status = 'pending'`);
  await t.call(u.owner, 'public.owner_decide_join($1, false)', [mine3.id]);
  await rejects(k2ask('D'), 'TOO_MANY_REQUESTS');
  await mode('invite_only');
});

test('store review demo: a separate kitchen with sample data; the reviewer sees only it; ended in one call', async () => {
  const reviewer = await t.createUser('reviewer');
  const demoOwner = await t.createUser('demo-owner');
  await assert.rejects(t.sql(`select app.create_review_demo('reviewer@test.local', 'reviewer@test.local')`), /two different emails/);
  await assert.rejects(t.sql(`select app.create_review_demo('nobody@test.local', 'demo-owner@test.local')`), /Create both users first/);
  await assert.rejects(t.sql(`select app.create_review_demo('custA@test.local', 'demo-owner@test.local')`), /fresh account/);
  const [{ k }] = await t.sql(`select app.create_review_demo('reviewer@test.local', 'demo-owner@test.local') as k`);
  assert.notEqual(k, w.k1);
  // the reviewer is a linked customer who accepted the rules, with lunches planned
  const meals = await t.as(reviewer, `select * from public.customer_my_orders($1, app.today(), app.today() + 6)`, [k]);
  assert.ok(meals.length >= 5, `expected planned lunches, got ${meals.length}`);
  assert.equal((await t.as(reviewer, 'select name from public.items order by name')).map((r) => r.name).join(','), 'Dal,Roti,Salad');
  // ...and nothing of the real kitchen
  for (const table of ['orders', 'customers', 'ledger_entries', 'payments', 'places']) {
    const rows = await t.as(reviewer, `select kitchen_id from public.${table}`);
    assert.ok(rows.every((r) => r.kitchen_id === k), `${table} leaked`);
  }
  assert.equal((await t.as(reviewer, 'select id from public.kitchens')).map((r) => r.id).join(), k);
  // never callable through the API
  for (const user of [reviewer, u.owner, null]) {
    await rejects(t.as(user, `select app.create_review_demo('a', 'b')`), 'permission denied');
    await rejects(t.as(user, `select app.end_review_demo('a')`), 'permission denied');
  }
  assert.equal((await t.sql(`select app.end_review_demo('reviewer@test.local') as n`))[0].n, 1);
  assert.equal((await t.as(reviewer, 'select id from public.orders')).length, 0);
  assert.equal((await t.as(reviewer, 'select id from public.kitchens')).length, 0);
  void demoOwner;
});
