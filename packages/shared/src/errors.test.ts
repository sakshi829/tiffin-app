import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERROR_MESSAGES, errorCode, errorMessage } from './errors.ts';

test('maps database codes, Postgres codes and network failures', () => {
  assert.equal(errorCode({ message: 'CUTOFF_PASSED', code: 'P0001' }), 'CUTOFF_PASSED');
  assert.equal(errorCode({ message: 'IMMUTABLE: ledger_entries rows cannot be updated', code: '42501' }), 'NOT_ALLOWED');
  assert.equal(errorCode({ message: 'duplicate key value violates unique constraint "x"', code: '23505' }), 'DUPLICATE');
  assert.equal(errorCode(new TypeError('Network request failed')), 'NETWORK');
  assert.equal(errorCode({ message: 'syntax error at or near "select"' }), 'UNKNOWN');
  assert.equal(errorCode(undefined), 'UNKNOWN');
});

test('never leaks internal details', () => {
  assert.equal(errorMessage({ message: 'relation "public.secret" does not exist' }), ERROR_MESSAGES.UNKNOWN);
});

test('every error code raised by the database has a message', () => {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
  const sql = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const raised = new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map((m) => m[1] ?? ''));
  const returned = new Set([...sql.matchAll(/'error', '([A-Z_]+)'/g)].map((m) => m[1] ?? ''));
  for (const code of [...raised, ...returned]) {
    assert.ok(code in ERROR_MESSAGES, `missing message for ${code}`);
  }
});
