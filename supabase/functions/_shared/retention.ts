// Pure helpers for the media-retention Edge Function (unit-tested with Node).
// receipts: only ORPHANS are ever listed by media_expired (no expense points to them; tested in 24-launch).
export const RETENTION_BUCKETS = ['delivery-proofs', 'voice-notes', 'payment-proofs', 'receipts'] as const;

/** Group expired objects by bucket in batches of `size` (Storage remove() takes a list of paths). */
export function batchesByBucket(rows: readonly { bucket_id: string; name: string }[], size = 100): { bucket: string; names: string[] }[] {
  const allowed = new Set<string>(RETENTION_BUCKETS);
  const byBucket = new Map<string, string[]>();
  for (const r of rows) {
    if (!allowed.has(r.bucket_id)) continue;                      // never touch kitchen-media or unknown buckets
    byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r.name]);
  }
  const out: { bucket: string; names: string[] }[] = [];
  for (const [bucket, names] of byBucket) {
    for (let i = 0; i < names.length; i += size) out.push({ bucket, names: names.slice(i, i + size) });
  }
  return out;
}
