// The staging attack pass (scripts/attack-pass), run here against the test database:
// setup.sql builds its fixture, every attack in checks.mjs must be blocked for the
// RIGHT reason (an access error, not a typo), and teardown.sql closes the accounts.
// The staging run (run.mjs) then only adds the real API and storage on top.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDb } from './helpers/db.mjs';
import { buildChecks, discover, isBlocked, PUBLIC_TABLES, USERS } from '../../scripts/attack-pass/checks.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/attack-pass');
const BASE = 'tester@test.local';
const sqlFile = (name) => fs.readFileSync(path.join(dir, name), 'utf8').replace(`v_base text := 'CHANGE-ME@example.com'`, `v_base text := '${BASE}'`);

let t; const users = {};
before(async () => {
  t = await createDb();
  for (const who of [...USERS, 'owner2']) {
    users[who] = { id: randomUUID(), label: who };
    await t.sql('insert into auth.users (id, email) values ($1, $2)', [users[who].id, BASE.replace('@', `+atk-${who}@`)]);
  }
});
after(async () => { await t.close(); });

/** Same operations as run.mjs, as plain SQL under the caller's role and claims (password sign-in = aal1). */
async function exec(who, op) {
  const user = who === 'anon' ? null : users[who];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = (w = {}) => Object.keys(w).length ? ' where ' + Object.entries(w).map(([k, v]) => `${k} = ${p(v)}`).join(' and ') : '';
  let sql;
  if (op.select) sql = `select * from public.${op.select}${where(op.where)} limit 20`;
  else if (op.rpc) sql = `select * from public.${op.rpc}(${Object.entries(op.args).map(([k, v]) => `${k} => ${p(v)}`).join(', ')})`;
  else if (op.update) sql = `update public.${op.update} set ${Object.entries(op.set).map(([k, v]) => `${k} = ${p(v)}`).join(', ')}${where(op.where)} returning *`;
  else if (op.insert) sql = `insert into public.${op.insert} (${Object.keys(op.values).join(', ')}) values (${Object.values(op.values).map(p).join(', ')}) returning *`;
  else if (op.delete) sql = `delete from public.${op.delete}${where(op.where)} returning *`;
  else throw new Error(`not runnable here: ${JSON.stringify(op)}`);
  try {
    let rows = await t.as(user, sql, params, { aal: 'aal1' });
    if (op.rpc) {
      const [{ retset }] = await t.sql(`select bool_or(proretset) as retset from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`, [op.rpc]);
      if (!retset) rows = rows[0] && Object.keys(rows[0]).length === 1 && op.rpc in rows[0] ? rows[0][op.rpc] : rows[0] ?? null;
    }
    return { data: rows };
  } catch (e) { return { error: { message: e.message } }; }
}

test('the attack list covers every table', async () => {
  const tables = (await t.sql(`select tablename from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.tablename);
  assert.deepEqual([...PUBLIC_TABLES].sort(), tables, 'update PUBLIC_TABLES in scripts/attack-pass/checks.mjs');
});

test('setup.sql refuses to run unedited or before the users exist, then builds the fixture once', async () => {
  await assert.rejects(t.sql(fs.readFileSync(path.join(dir, 'setup.sql'), 'utf8')), /Put your own email address/);
  await assert.rejects(t.sql(sqlFile('setup.sql').replace(BASE, 'nobody@test.local')), /Create the user nobody\+atk-owner1@test.local first/);
  await t.sql(sqlFile('setup.sql'));
  await t.sql(sqlFile('setup.sql'));   // second run: nothing to do
  assert.equal((await t.sql(`select count(*)::int as n from public.kitchens`))[0].n, 2);
});

test('every attack is blocked, each by an access rule (not by a mistake in the attack)', async () => {
  const [{ today }] = await t.sql(`select app.today()::text as today`);
  const ctx = await discover(async (who, op) => { const r = await exec(who, op); if (r.error) throw new Error(r.error.message); return r.data; }, today);
  const checks = buildChecks(ctx).filter((c) => !c.laptopOnly);
  assert.ok(checks.length > 150, `only ${checks.length} checks`);
  const access = /permission denied|row-level security|NOT_ALLOWED|NOT_FOUND|NOT_A_CUSTOMER|NOT_STAFF|STEP_UP_REQUIRED|NOT_LINKED|TERMS/;
  const problems = [];
  for (const check of checks) {
    const res = await exec(check.who, check.op);
    if (!isBlocked(check, res)) problems.push(`GOT THROUGH: ${check.who} ${check.name}: ${JSON.stringify(res.data).slice(0, 120)}`);
    else if (res.error && !access.test(res.error.message)) problems.push(`blocked for the wrong reason: ${check.who} ${check.name}: ${res.error.message}`);
  }
  assert.deepEqual(problems, []);
});

test('teardown.sql closes the test accounts', async () => {
  await t.sql(sqlFile('teardown.sql'));
  for (const who of ['custa', 'custb', 'custc']) {
    assert.equal((await t.as(users[who], 'select id from public.orders', [], { aal: 'aal1' })).length, 0, who);
  }
  assert.equal((await t.as(users.staff, 'select id from public.kitchens', [], { aal: 'aal1' })).length, 0);
});
