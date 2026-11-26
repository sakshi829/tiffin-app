// verify_live.sql is the check you run on the REAL Supabase project after each
// deploy. Run it here too, so it can never go stale: on a correctly configured
// database it must report no problems, and it must catch real misconfigurations.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from './helpers/db.mjs';

const SQL = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'verify_live.sql'), 'utf8');
let t;
const problems = async () => (await t.db.exec(SQL)).flatMap((r) => r.rows).filter((row) => !('future_objects' in row));

before(async () => {
  t = await createDb();
  // What Setup steps 13-14 tell you to set in the dashboard
  await t.sql(`update storage.buckets set file_size_limit = 2097152, allowed_mime_types = array['image/jpeg','image/png','image/webp'] where id <> 'voice-notes'`);
  await t.sql(`update storage.buckets set file_size_limit = 1048576,
               allowed_mime_types = array['audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/webm'] where id = 'voice-notes'`);
});
after(async () => { await t.close(); });

test('a correctly set-up database passes every live check', async () => {
  assert.deepEqual(await problems(), []);
});

test('the live check catches loose buckets, public buckets and extra grants', async () => {
  await t.sql(`update storage.buckets set allowed_mime_types = array['image/jpeg','application/octet-stream'] where id = 'receipts'`);
  await t.sql(`update storage.buckets set file_size_limit = null where id = 'voice-notes'`);
  await t.sql(`update storage.buckets set public = true where id = 'payment-proofs'`);
  await t.sql('grant insert on public.orders to authenticated');
  const found = (await problems()).map((p) => `${p.problem}:${p.id ?? p.wanted ?? p.table_name}`).sort();
  assert.deepEqual(found, [
    'BUCKET LIMIT MISSING OR TOO LOOSE:receipts',
    'BUCKET LIMIT MISSING OR TOO LOOSE:voice-notes',
    'BUCKET MISSING OR PUBLIC:payment-proofs',
    'UNEXPECTED WRITE GRANT:orders',
  ]);
});
