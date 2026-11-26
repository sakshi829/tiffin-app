#!/usr/bin/env node
// =============================================================================
// ATTACK PASS against STAGING, through the real Supabase API (the same way a
// tampered app or a script would). Run on the personal laptop:
//
//   1. STAGING SQL editor: run scripts/attack-pass/setup.sql (read its header first)
//   2. ATTACK_SUPABASE_URL=https://<staging-ref>.supabase.co \
//      ATTACK_ANON_KEY=<staging anon key> \
//      ATTACK_EMAIL_BASE=you@gmail.com ATTACK_PASSWORD='<the test users password>' \
//      node scripts/attack-pass/run.mjs --staging
//   3. Every line must say PASS. Exit code 0 = all blocked, 1 = something got through.
//   4. Optional: scripts/attack-pass/teardown.sql
//
// Only the anon key is used (never the service_role key). Some attacks would
// change data if they got through, so it refuses to run without --staging and
// refuses the URL in ATTACK_LIVE_URL if you set it (put the live URL there).
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { buildChecks, discover, isBlocked, USERS } from './checks.mjs';

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Missing ${k} (see the top of this file).`); process.exit(2); } return v; };
if (!process.argv.includes('--staging')) { console.error('Add --staging to confirm this is the STAGING project.'); process.exit(2); }
const url = env('ATTACK_SUPABASE_URL').replace(/\/+$/, '');
if (process.env.ATTACK_LIVE_URL && process.env.ATTACK_LIVE_URL.replace(/\/+$/, '') === url) { console.error('That is the LIVE project. Stopping.'); process.exit(2); }
const anonKey = env('ATTACK_ANON_KEY');
if (anonKey.startsWith('sb_secret_') || /service_role/.test(Buffer.from(anonKey.split('.')[1] ?? '', 'base64url').toString())) { console.error('That is the service_role key. Use the anon key.'); process.exit(2); }
const base = env('ATTACK_EMAIL_BASE');
const password = env('ATTACK_PASSWORD');

const newClient = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const clients = { anon: newClient() };
for (const who of USERS) {
  const c = newClient();
  const email = base.replace('@', `+atk-${who}@`);
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) { console.error(`Cannot sign in ${email}: ${error.message}`); process.exit(2); }
  clients[who] = c;
}

/** One API call; returns { data } or { error }. */
async function exec(who, op) {
  const c = clients[who];
  const filtered = (q) => Object.entries(op.where ?? {}).reduce((acc, [k, v]) => acc.eq(k, v), q);
  let r;
  if (op.select) r = await filtered(c.from(op.select).select('*').limit(20));
  else if (op.rpc) r = await c.rpc(op.rpc, op.args);
  else if (op.update) r = await filtered(c.from(op.update).update(op.set)).select();
  else if (op.insert) r = await c.from(op.insert).insert(op.values).select();
  else if (op.delete) r = await filtered(c.from(op.delete).delete()).select();
  else if (op.upload) r = await c.storage.from(op.upload).upload(op.path, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { contentType: 'image/jpeg', upsert: false });
  else if (op.list) r = await c.storage.from(op.list).list(op.prefix);
  else throw new Error(`unknown op ${JSON.stringify(op)}`);
  return r.error ? { error: r.error } : { data: r.data };
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const ctx = await discover(async (who, op) => { const r = await exec(who, op); if (r.error) throw new Error(r.error.message); return r.data; }, today);
console.log(`Fixture found: kitchen 1 ${ctx.K1}, kitchen 2 ${ctx.K2}\n`);

let failed = 0;
const checks = buildChecks(ctx);
for (const check of checks) {
  let res;
  try { res = await exec(check.who, check.op); } catch (e) { res = { error: { message: String(e.message ?? e) } }; }
  const ok = isBlocked(check, res);
  if (!ok) failed++;
  const why = res.error ? (res.error.message ?? res.error.code ?? 'error') : 'no data';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${check.who.padEnd(8)} ${check.name}${ok ? `  (${why})` : `  -> GOT THROUGH: ${JSON.stringify(res.data).slice(0, 200)}`}`);
}
console.log(`\n${checks.length - failed} of ${checks.length} attacks blocked.${failed ? `  ${failed} GOT THROUGH: do not go live; see docs/PENDING_AND_TESTING.md.` : ''}`);
for (const c of Object.values(clients)) await c.auth.signOut().catch(() => {});
process.exit(failed ? 1 : 0);
