// F35: progress toward the next loyalty reward, for the owner and the customer.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

test('off until the owner switches loyalty on', async () => {
  assert.deepEqual(await t.call(u.custA, 'public.loyalty_progress($1)', [w.cust.A]), { active: false });
});

test('counts delivered meals the same way as the reward; private to the owner and that customer', async () => {
  await t.call(u.owner, 'public.owner_set_loyalty($1, true, 5, 2000, $2)', [w.k1, 'free salad']);
  for (const d of ['2026-12-01', '2026-12-02', '2026-12-03']) {
    const o = await w.order(w.cust.A, d, 'lunch');
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  }
  const expected = { active: true, delivered: 3, every_n: 5, toward_next: 3, to_go: 2, reward_label: 'free salad', reward_paise: 2000, rewards_given: 0 };
  assert.deepEqual(await t.call(u.custA, 'public.loyalty_progress($1)', [w.cust.A]), expected);
  assert.deepEqual(await t.call(u.owner, 'public.loyalty_progress($1)', [w.cust.A]), expected);
  for (const d of ['2026-12-04', '2026-12-05']) {
    const o = await w.order(w.cust.A, d, 'lunch');
    await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [o.id, 'delivered']);
  }
  const after5 = await t.call(u.custA, 'public.loyalty_progress($1)', [w.cust.A]);
  assert.deepEqual([after5.delivered, after5.toward_next, after5.to_go, after5.rewards_given], [5, 0, 5, 1]);
  for (const other of [u.custB, u.delivery, u.owner2, u.stranger]) {
    await rejects(t.call(other, 'public.loyalty_progress($1)', [w.cust.A]), 'NOT_FOUND');
  }
});
