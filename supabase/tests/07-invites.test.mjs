// Invite-only onboarding: single use, expiry, revocation, brute-force lockout,
// hashes only, re-linking only by the owner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, custE, custF;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  [{ id: custE }] = await t.as(u.owner, `insert into public.customers (kitchen_id, full_name) values ($1, 'Esha') returning id`, [w.k1]);
  [{ id: custF }] = await t.as(u.owner, `insert into public.customers (kitchen_id, full_name) values ($1, 'Farhan') returning id`, [w.k1]);
});
after(async () => { await t.close(); });

const redeem = (user, code) => t.call(user, 'public.redeem_invite($1)', [code]);

test('codes look like XXXXX-XXXXX, only a SHA-256 hash is stored', async () => {
  const code = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custE]);
  assert.match(code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
  const rows = await t.sql('select code_hash from public.invites where customer_id = $1 and revoked_at is null', [custE]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].code_hash, createHash('sha256').update(code.replace('-', '')).digest('hex'));
  assert.ok(!JSON.stringify(await t.sql('select * from public.invites')).includes(code.replace('-', '')));
});

test('a new invite revokes the previous one; codes are single use; typing is forgiving', async () => {
  const old = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custE]);
  const fresh = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custE]);
  assert.deepEqual(await redeem(u.stranger, old), { ok: false, error: 'INVALID_CODE' });
  const r = await redeem(u.stranger, ` ${fresh.toLowerCase().replace('-', ' ')} `);
  assert.equal(r.ok, true);
  assert.equal((await t.as(u.stranger, 'select count(*)::int n from public.orders'))[0].n, 0);   // linked, no subscription yet
  assert.equal((await t.as(u.stranger, 'select full_name from public.customers'))[0].full_name, 'Esha');
  const u2 = await t.createUser('another');
  assert.deepEqual(await redeem(u2, fresh), { ok: false, error: 'INVALID_CODE' });
});

test('owner cannot invite an already-linked customer; a linked user cannot link twice', async () => {
  await rejects(t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custE]), 'ALREADY_LINKED');
  const code = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custF]);
  assert.deepEqual(await redeem(u.custA, code), { ok: false, error: 'ALREADY_LINKED' });
});

test('expired and revoked codes fail with the same answer as wrong codes', async () => {
  const code = await t.call(u.owner, 'public.owner_create_customer_invite($1, 1)', [custF]);
  const [{ id }] = await t.sql('select id from public.invites where customer_id = $1 and revoked_at is null and used_at is null', [custF]);
  const late = await t.createUser('late');
  await t.setNow(IST('2026-12-02', '10:00'));          // > 1 day later
  assert.deepEqual(await redeem(late, code), { ok: false, error: 'INVALID_CODE' });
  await t.setNow(IST('2026-12-01', '09:00'));
  const code2 = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custF]);
  const [{ id: id2 }] = await t.sql('select id from public.invites where customer_id = $1 and revoked_at is null and used_at is null', [custF]);
  await t.call(u.owner, 'public.owner_revoke_invite($1)', [id2]);
  assert.deepEqual(await redeem(late, code2), { ok: false, error: 'INVALID_CODE' });
  assert.ok(id);
});

test('brute force: 5 wrong codes per hour, then even a valid code is refused', async () => {
  const attacker = await t.createUser('attacker');
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(await redeem(attacker, `AAAAA-AAAA${'BCDEF'[i]}`), { ok: false, error: 'INVALID_CODE' });
  }
  const valid = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [custF]);
  assert.deepEqual(await redeem(attacker, valid), { ok: false, error: 'TOO_MANY_ATTEMPTS' });
  await t.setNow(IST('2026-12-01', '10:05'));          // next hour window
  assert.equal((await redeem(attacker, valid)).ok, true);
});

test('staff invites create staff with exactly the chosen role', async () => {
  const code = await t.call(u.owner, 'public.owner_create_staff_invite($1, $2, $3, 3)', [w.k1, 'kitchen_delivery', 'Kiran']);
  const s = await t.createUser('kiran');
  assert.equal((await redeem(s, code)).ok, true);
  const [row] = await t.sql('select role, can_see_phone, active from public.staff_members where user_id = $1', [s.id]);
  assert.deepEqual(row, { role: 'kitchen_delivery', can_see_phone: false, active: true });
});

test('unlinking (lost phone) needs step-up and cuts access immediately; a new invite re-links', async () => {
  assert.ok((await t.as(u.custA, 'select count(*)::int n from public.orders'))[0].n > 0);
  await rejects(t.call(u.owner, 'public.owner_unlink_customer($1)', [w.cust.A], { mfaAgoSec: 3600 }), 'STEP_UP_REQUIRED');
  await t.call(u.owner, 'public.owner_unlink_customer($1)', [w.cust.A]);
  assert.equal((await t.as(u.custA, 'select count(*)::int n from public.orders'))[0].n, 0);
  const newPhone = await t.createUser('custA-new-phone');
  const code = await t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [w.cust.A]);
  assert.equal((await redeem(newPhone, code)).ok, true);
  assert.ok((await t.as(newPhone, 'select count(*)::int n from public.orders'))[0].n > 0);
});

test('archived customers cannot be invited', async () => {
  await t.as(u.owner, `update public.customers set status = 'archived' where id = $1`, [w.cust.B]);
  await t.call(u.owner, 'public.owner_unlink_customer($1)', [w.cust.B]);
  await rejects(t.call(u.owner, 'public.owner_create_customer_invite($1, 7)', [w.cust.B]), 'CUSTOMER_ARCHIVED');
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.customers'))[0].n, 0);
});
