// Supabase Edge Function: delete photos and voice notes past their retention period
// (decision 20), files of erased customers and receipt photos no expense uses.
// Files are removed through the Storage API: deleting rows in SQL
// would leave the file in storage, still billed (Supabase docs).
// Called daily by pg_cron with the x-cron-secret header (setup guide step 13).
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';   // exact version: this code runs with the service key
import { safeEqual } from '../_shared/push.ts';
import { batchesByBucket } from '../_shared/retention.ts';

function serviceKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (keys) {
    try {
      const k = JSON.parse(keys)?.default;
      if (typeof k === 'string' && k) return k;
    } catch { /* legacy below */ }
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacy) return legacy;
  throw new Error('No service key available');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) {
    return new Response('Unauthorized', { status: 401 });
  }
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.rpc('media_expired', { p_limit: 1000 });
  if (error) {
    console.error('media_expired failed', error.message);
    return new Response('list failed', { status: 500 });
  }
  let removed = 0;
  let forgotten = 0;
  for (const batch of batchesByBucket((data ?? []) as { bucket_id: string; name: string }[])) {
    const { data: gone, error: removeError } = await db.storage.from(batch.bucket).remove(batch.names);
    if (removeError) { console.error('remove failed', batch.bucket, removeError.message); continue; }
    removed += gone?.length ?? 0;
    // The batch succeeded, so none of these files exist any more (removed now, or already gone):
    // clear their references, and the apps show nothing instead of a broken photo (F32).
    const items = batch.names.map((name) => ({ bucket: batch.bucket, name }));
    if (items.length > 0) {
      const { data: n, error: forgetError } = await db.rpc('media_forget', { p_items: items });
      if (forgetError) console.error('media_forget failed', forgetError.message);
      else forgotten += Number(n ?? 0);
    }
  }
  return Response.json({ expired: (data ?? []).length, removed, forgotten });   // counts only, no file names
});
