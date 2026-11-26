// Unit tests for the media-retention Edge Function's grouping logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { batchesByBucket } from '../functions/_shared/retention.ts';

test('groups by bucket in batches and never touches kitchen media or unknown buckets', () => {
  const rows = [
    ...Array.from({ length: 150 }, (_, i) => ({ bucket_id: 'delivery-proofs', name: `k/c/${i}.jpg` })),
    { bucket_id: 'voice-notes', name: 'k/c/v.m4a' },
    { bucket_id: 'receipts', name: 'k/orphan.jpg' },
    { bucket_id: 'kitchen-media', name: 'k/upi-qr.jpg' },
    { bucket_id: 'other', name: 'x' },
  ];
  const batches = batchesByBucket(rows);
  assert.deepEqual(batches.map((b) => [b.bucket, b.names.length]), [['delivery-proofs', 100], ['delivery-proofs', 50], ['voice-notes', 1], ['receipts', 1]]);
});
