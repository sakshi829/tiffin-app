// Phase 5b: storage access rules (photos, payment screenshots, voice notes, kitchen media),
// retention list, special menus, QR box stickers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, IST } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u, oA, oB;
before(async () => {
  w = await buildWorld(); t = w.t; u = w.u;
  oA = await w.order(w.cust.A, '2026-12-01', 'lunch');
  oB = await w.order(w.cust.B, '2026-12-01', 'lunch');
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${oA.id}}`, w.staff.delivery]);
  await t.call(u.owner, 'public.owner_assign_orders($1, $2::uuid[], $3)', [w.k1, `{${oB.id}}`, w.staff.delivery2]);
});
after(async () => { await t.close(); });

// Upload = INSERT only (Supabase docs: no SELECT needed when upsert is false), so no RETURNING here.
const put = (user, bucket, name) => t.as(user, 'insert into storage.objects (bucket_id, name) values ($1, $2)', [bucket, name]);
const canSee = async (user, bucket, name) =>
  (await t.as(user, 'select count(*)::int n from storage.objects where bucket_id = $1 and name = $2', [bucket, name]))[0].n === 1;

test('delivery photo: only the assigned delivery person uploads; only owner + that customer can see it', async () => {
  const pA = await t.call(u.delivery, 'public.staff_proof_path($1)', [oA.id]);
  assert.equal(pA, `${w.k1}/${w.cust.A}/${oA.id}.jpg`);
  await rejects(t.call(u.delivery2, 'public.staff_proof_path($1)', [oA.id]), 'NOT_FOUND');
  await rejects(t.call(u.custA, 'public.staff_proof_path($1)', [oA.id]), 'NOT_FOUND');
  await put(u.delivery, 'delivery-proofs', pA);
  await rejects(put(u.delivery, 'delivery-proofs', `${w.k1}/${w.cust.B}/${oB.id}.jpg`), 'row-level security');   // not assigned
  await rejects(put(u.kitchen, 'delivery-proofs', `${w.k1}/${w.cust.A}/${oA.id}.png`), 'row-level security');
  await rejects(put(u.custA, 'delivery-proofs', `${w.k1}/${w.cust.A}/${oA.id}.webp`), 'row-level security');
  assert.equal(await canSee(u.custA, 'delivery-proofs', pA), true);
  assert.equal(await canSee(u.owner, 'delivery-proofs', pA), true);
  for (const user of [u.custB, u.delivery2, u.owner2, u.stranger]) assert.equal(await canSee(user, 'delivery-proofs', pA), false);
  assert.equal(await canSee(null, 'delivery-proofs', pA), false);   // anon

  await t.call(u.delivery, 'public.staff_attach_proof($1, $2)', [oA.id, pA]);
  assert.equal((await t.as(u.custA, 'select path from public.delivery_proofs'))[0].path, pA);
  assert.equal((await t.as(u.custB, 'select count(*)::int n from public.delivery_proofs'))[0].n, 0);
  await rejects(t.call(u.delivery, 'public.staff_attach_proof($1, $2)', [oA.id, `${w.k1}/${w.cust.A}/${oA.id}.png`]), 'INVALID_REQUEST'); // no such file
  await rejects(t.call(u.delivery2, 'public.staff_attach_proof($1, $2)', [oA.id, pA]), 'NOT_FOUND');
});

test('path tricks are rejected: other kitchens, traversal, wrong types, extra folders', async () => {
  for (const bad of [
    `${w.k2}/${w.cust.A}/${oA.id}.jpg`, `${w.k1}/../${w.cust.A}/${oA.id}.jpg`, `${w.k1}/${w.cust.A}/${oA.id}.exe`,
    `${w.k1}/${w.cust.A}/x/${oA.id}.jpg`, `${w.k1}/${w.cust.A}/${oA.id}.jpg.php`, `not-a-uuid/${w.cust.A}/${oA.id}.jpg`,
  ]) {
    await rejects(put(u.delivery, 'delivery-proofs', bad), 'row-level security');
  }
  await rejects(put(u.owner, 'unknown-bucket', `${w.k1}/x.jpg`), 'row-level security|foreign key');
});

test('payment screenshot: own folder only, attach to own waiting payment only', async () => {
  const p = await t.call(u.custA, 'public.customer_submit_payment($1, 5000, $2, $3, $4, null)', [w.k1, 'UTRSHOT0001', '2026-12-01', 'shot-pay-01']);
  const name = `${w.k1}/${w.cust.A}/${p.payment_id}.jpg`;
  await put(u.custA, 'payment-proofs', name);
  await rejects(put(u.custA, 'payment-proofs', `${w.k1}/${w.cust.B}/${p.payment_id}.jpg`), 'row-level security');
  await rejects(t.call(u.custB, 'public.customer_attach_payment_proof($1, $2)', [p.payment_id, name]), 'NOT_FOUND');
  await t.call(u.custA, 'public.customer_attach_payment_proof($1, $2)', [p.payment_id, name]);
  assert.equal(await canSee(u.owner, 'payment-proofs', name), true);
  assert.equal(await canSee(u.custB, 'payment-proofs', name), false);
  await t.call(u.owner, 'public.owner_confirm_payment($1)', [p.payment_id]);
  await rejects(t.call(u.custA, 'public.customer_attach_payment_proof($1, $2)', [p.payment_id, name]), 'INVALID_STATUS');
});

test('voice notes: up to 30 s, customer own folder or owner; private to that chat', async () => {
  const v1 = `${w.k1}/${w.cust.A}/11111111-1111-4111-8111-111111111111.m4a`;
  await put(u.custA, 'voice-notes', v1);
  await rejects(put(u.custA, 'voice-notes', `${w.k1}/${w.cust.A}/22222222-2222-4222-8222-222222222222.mp3`), 'row-level security');
  await rejects(put(u.custB, 'voice-notes', `${w.k1}/${w.cust.A}/33333333-3333-4333-8333-333333333333.m4a`), 'row-level security');
  await rejects(t.call(u.custA, 'public.customer_send_voice($1, $2, 31)', [w.k1, v1]), 'INVALID_REQUEST');
  await t.call(u.custA, 'public.customer_send_voice($1, $2, 12)', [w.k1, v1]);
  const [m] = await t.as(u.owner, 'select body, voice_path, voice_seconds from public.chat_messages');
  assert.deepEqual(m, { body: 'Voice note (12 s)', voice_path: v1, voice_seconds: 12 });
  const v2 = `${w.k1}/${w.cust.A}/44444444-4444-4444-8444-444444444444.m4a`;
  await put(u.owner, 'voice-notes', v2);
  await t.call(u.owner, 'public.owner_send_voice($1, $2, 5)', [w.cust.A, v2]);
  assert.equal(await canSee(u.custA, 'voice-notes', v2), true);
  assert.equal(await canSee(u.custB, 'voice-notes', v2), false);
  await rejects(t.call(u.custB, 'public.customer_send_voice($1, $2, 5)', [w.k1, v1]), 'INVALID_REQUEST');   // not B's folder
});

test('kitchen media (UPI QR): owner uploads, members read, path must be in own kitchen, no overwrite, only owner deletes', async () => {
  const qr = `${w.k1}/upi-qr.png`;
  await put(u.owner, 'kitchen-media', qr);
  await rejects(put(u.custA, 'kitchen-media', `${w.k1}/evil.png`), 'row-level security');
  await rejects(put(u.owner2, 'kitchen-media', `${w.k1}/evil.png`), 'row-level security');
  assert.equal(await canSee(u.custA, 'kitchen-media', qr), true);
  assert.equal(await canSee(u.delivery, 'kitchen-media', qr), true);
  assert.equal(await canSee(u.custC, 'kitchen-media', qr), false);
  await rejects(t.call(u.owner, `public.owner_update_settings($1, $2::jsonb)`, [w.k1, JSON.stringify({ upi_qr_path: `${w.k2}/upi-qr.png` })]), 'check constraint');
  await t.call(u.owner, `public.owner_update_settings($1, $2::jsonb)`, [w.k1, JSON.stringify({ upi_qr_path: qr })]);
  const upd = await t.as(u.owner, `update storage.objects set name = $1 where name = $2 returning id`, [`${w.k1}/other.png`, qr]);
  assert.equal(upd.length, 0, 'no overwrite / rename');
  assert.equal((await t.as(u.custA, `delete from storage.objects where name = $1 returning id`, [qr])).length, 0);
  assert.equal((await t.as(u.custA, `delete from storage.objects where bucket_id = 'delivery-proofs' returning id`)).length, 0);
  assert.equal((await t.as(u.owner, `delete from storage.objects where name = $1 returning id`, [qr])).length, 1);
});

test('retention list: delivery photos + voice after the retention days, payment screenshots after 400 days; service only', async () => {
  await rejects(t.as(u.owner, 'select * from public.media_expired(100)'), 'permission denied');
  await t.sql(`update storage.objects set created_at = '2026-10-01' where bucket_id in ('delivery-proofs','voice-notes','payment-proofs')`);
  const list = await t.asService('select * from public.media_expired(100)');
  const buckets = [...new Set(list.map((r) => r.bucket_id))].sort();
  assert.deepEqual(buckets, ['delivery-proofs', 'voice-notes']);
  await t.setNow('2027-11-15T00:00:00Z');
  assert.ok((await t.asService('select * from public.media_expired(100)')).some((r) => r.bucket_id === 'payment-proofs'));
  await t.setNow(IST('2026-12-01', '09:00'));
});

test('special menu: owner offers it, customers order before the deadline, max orders, normal billing', async () => {
  const [{ id: thali }] = await t.as(u.owner, `insert into public.tiffin_types (kitchen_id, name, is_special, pricing_mode, description)
    values ($1, 'Diwali Thali', true, 'fixed', 'Puri, shrikhand, 3 sabzi') returning id`, [w.k1]);
  await rejects(t.call(u.owner, 'public.owner_save_special(null, $1, $2, $3::date, $4, $5::timestamptz, 1, true)',
    [w.k1, thali, '2026-12-04', 'lunch', IST('2026-12-03', '20:00')]), 'PRICE_NOT_SET');
  await t.call(u.owner, 'public.owner_set_tiffin_price($1, 25000, $2)', [thali, '2026-12-01']);
  await rejects(t.call(u.owner, 'public.owner_save_special(null, $1, $2, $3::date, $4, $5::timestamptz, 1, true)',
    [w.k1, w.types.veg, '2026-12-04', 'lunch', IST('2026-12-03', '20:00')]), 'INVALID_REQUEST');     // not a special type
  await rejects(t.call(u.owner, 'public.owner_save_special(null, $1, $2, $3::date, $4, $5::timestamptz, 1, true)',
    [w.k1, thali, '2026-12-04', 'lunch', IST('2026-12-04', '15:00')]), 'INVALID_DATES');           // deadline after delivery
  const sp = await t.call(u.owner, 'public.owner_save_special(null, $1, $2, $3::date, $4, $5::timestamptz, 1, true)',
    [w.k1, thali, '2026-12-04', 'lunch', IST('2026-12-03', '20:00')]);

  const [offer] = await t.as(u.custA, 'select * from public.customer_special_menus($1)', [w.k1]);
  assert.deepEqual([offer.name, Number(offer.price_paise), offer.remaining, offer.my_order_id], ['Diwali Thali', 25000, 1, null]);
  const o1 = await t.call(u.custA, 'public.customer_order_special($1)', [sp]);
  assert.equal(await t.call(u.custA, 'public.customer_order_special($1)', [sp]), o1, 'ordering twice = same order');
  await rejects(t.call(u.custB, 'public.customer_order_special($1)', [sp]), 'SOLD_OUT');
  const day = await t.as(u.owner, 'select customer_name, tiffin_type_name from public.owner_day_orders($1, $2::date)', [w.k1, '2026-12-04']);
  assert.ok(day.some((d) => d.customer_name === 'Priya' && d.tiffin_type_name === 'Diwali Thali'));
  await t.call(u.custA, 'public.customer_skip_meal($1)', [o1]);                                           // free before cutoff
  assert.equal(await t.call(u.custB, 'public.customer_order_special($1)', [sp]) !== null, true, 'place freed up');
  await t.setNow(IST('2026-12-03', '20:01'));
  await rejects(t.call(u.custA, 'public.customer_order_special($1)', [sp]), 'CUTOFF_PASSED');
  await t.setNow(IST('2026-12-04', '13:20'));
  const ob = (await t.sql('select id from public.orders where special_menu_id = $1 and customer_id = $2', [sp, w.cust.B]))[0].id;
  await t.call(u.owner, 'public.owner_set_order_status($1, $2, null)', [ob, 'delivered']);
  assert.ok((await t.sql(`select 1 from public.ledger_entries where order_id = $1 and kind = 'meal' and amount_paise = 25000`, [ob])).length === 1);
  await t.setNow(IST('2026-12-01', '09:00'));
});

test('QR stickers: numbered codes; issue at packing; scan at pickup finds the customer', async () => {
  assert.deepEqual(await t.call(u.owner, 'public.owner_create_boxes($1, 3)', [w.k1]), ['AK-001', 'AK-002', 'AK-003']);
  assert.deepEqual(await t.call(u.owner, 'public.owner_create_boxes($1, 2)', [w.k1]), ['AK-004', 'AK-005']);
  await rejects(t.call(u.custA, 'public.owner_create_boxes($1, 2)', [w.k1]), 'NOT_ALLOWED');
  await rejects(t.call(u.owner, 'public.owner_create_boxes($1, 500)', [w.k1]), 'INVALID_QUANTITY');

  await t.call(u.kitchen, 'public.staff_box_issued($1, $2)', [oA.id, 'ak-001']);
  await rejects(t.call(u.custA, 'public.staff_box_issued($1, $2)', [oA.id, 'AK-002']), 'NOT_FOUND');
  await rejects(t.call(u.kitchen, 'public.staff_box_issued($1, $2)', [oA.id, 'AK-999']), 'UNKNOWN_BOX');
  await t.setNow(IST('2026-12-01', '13:20'));
  await t.call(u.delivery, 'public.staff_mark_delivered($1)', [oA.id]);
  await rejects(t.call(u.kitchen, 'public.staff_box_scan_collect($1, $2, null)', [w.k1, 'AK-001']), 'NOT_ALLOWED');
  await rejects(t.call(u.delivery, 'public.staff_box_scan_collect($1, $2, null)', [w.k1, 'AK-002']), 'BOX_NOT_ISSUED');
  const r1 = await t.call(u.delivery2, 'public.staff_box_scan_collect($1, $2, $3)', [w.k1, 'AK-001', 'scan-0001']);
  assert.equal(r1.customer_name, 'Priya');
  await t.call(u.delivery2, 'public.staff_box_scan_collect($1, $2, $3)', [w.k1, 'AK-001', 'scan-0002']);
  const [{ n }] = await t.sql(`select count(*)::int n from public.box_movements where kind = 'collected' and order_id = $1`, [oA.id]);
  assert.equal(n, 1, 'scanning twice records one pickup');
  assert.ok(!(await t.as(u.owner, 'select * from public.owner_boxes_out($1)', [w.k1])).some((b) => b.order_id === oA.id));
});
