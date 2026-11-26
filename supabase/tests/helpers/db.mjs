// Test database: PGlite (real Postgres compiled to WASM, runs in-process)
// + Supabase shim + every migration in order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../../migrations');

export class TestDb {
  /** @param {PGlite} db */
  constructor(db) {
    this.db = db;
    this.nowMs = Date.now();
  }

  /** Run as the database owner (like the Supabase SQL editor / cron). */
  async sql(query, params = []) {
    const r = await this.db.query(query, params);
    return r.rows;
  }

  /** Move the SERVER clock (app.now()). Clients can never do this. */
  async setNow(iso) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?Z$/.test(iso)) throw new Error(`bad iso: ${iso}`);
    this.nowMs = Date.parse(iso);
    await this.db.exec(
      `create or replace function app.now() returns timestamptz language sql stable set search_path = '' as $$ select '${iso}'::timestamptz $$;`,
    );
  }

  async createUser(label) {
    const id = randomUUID();
    await this.db.query('insert into auth.users (id, email) values ($1, $2)', [id, `${label}@test.local`]);
    return { id, label };
  }

  /**
   * Run a query as a user, exactly like a request through the Supabase API:
   * role `authenticated` (or `anon` when user is null) + JWT claims.
   * opts.aal: 'aal1' | 'aal2' (default aal2)
   * opts.mfaAgoSec: seconds since the TOTP verification (default 60)
   */
  async as(user, query, params = [], opts = {}) {
    return this.db.transaction(async (tx) => {
      if (user) {
        const aal = opts.aal ?? 'aal2';
        const claims = {
          sub: user.id,
          role: 'authenticated',
          aal,
          amr: opts.amr ?? (aal === 'aal2'
            ? [{ method: 'totp', timestamp: Math.floor(this.nowMs / 1000) - (opts.mfaAgoSec ?? 60) }]
            : [{ method: 'oauth', timestamp: Math.floor(this.nowMs / 1000) - 3600 }]),
        };
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await tx.exec('set local role authenticated');
      } else {
        await tx.exec('set local role anon');
      }
      const r = await tx.query(query, params);
      return r.rows;
    });
  }

  /** Run as the service role (what the send-push Edge Function uses). */
  async asService(query, params = []) {
    return this.db.transaction(async (tx) => {
      await tx.exec('set local role service_role');
      return (await tx.query(query, params)).rows;
    });
  }

  /** Shorthand: call a function as a user and return the single value. */
  async call(user, fnSql, params = [], opts = {}) {
    const rows = await this.as(user, `select ${fnSql} as v`, params, opts);
    return rows[0]?.v;
  }

  async close() {
    await this.db.close();
  }
}

export async function createDb() {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(fs.readFileSync(path.join(here, 'supabase-shim.sql'), 'utf8'));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await db.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
    } catch (e) {
      e.message = `migration ${f} failed: ${e.message}`;
      throw e;
    }
  }
  return new TestDb(db);
}

/** Assert a promise rejects with a message containing `code`. */
export async function rejects(promise, code) {
  await assert.rejects(promise, (e) => {
    assert.match(String(e.message), new RegExp(code), `expected error ${code}, got: ${e.message}`);
    return true;
  });
}
