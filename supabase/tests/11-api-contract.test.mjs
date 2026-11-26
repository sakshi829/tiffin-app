// The apps' API contract (packages/shared/src/api-contract.ts) must match the
// real schema: every function + exact parameter names, every column.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from './helpers/db.mjs';
import { RPC_PARAMS, TABLE_COLUMNS } from '../../packages/shared/src/api-contract.ts';

let t;
before(async () => { t = await createDb(); });
after(async () => { await t.close(); });

test('every RPC the apps call exists with exactly these parameter names and is executable', async () => {
  for (const [name, params] of Object.entries(RPC_PARAMS)) {
    const rows = await t.sql(`select p.oid, coalesce(p.proargnames, '{}') as args, p.proargmodes as modes
                              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'public' and p.proname = $1`, [name]);
    assert.equal(rows.length, 1, `public.${name} must exist exactly once (PostgREST cannot pick between overloads)`);
    const modes = rows[0].modes;   // null = all IN
    const inArgs = rows[0].args.filter((_, i) => !modes || ['i', 'b'].includes(modes[i]));
    assert.deepEqual(inArgs, [...params], `parameters of ${name}`);
    const [{ ok }] = await t.sql(`select has_function_privilege('authenticated', $1::oid, 'execute') as ok`, [rows[0].oid]);
    assert.equal(ok, true, `${name} must be executable by authenticated`);
  }
});

test('every column the apps use exists', async () => {
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const rows = await t.sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table]);
    const existing = new Set(rows.map((r) => r.column_name));
    assert.ok(existing.size > 0, `table ${table} missing`);
    for (const c of columns) assert.ok(existing.has(c), `${table}.${c} missing`);
  }
});
