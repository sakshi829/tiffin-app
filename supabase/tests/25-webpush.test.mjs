// Web Push for the web app (iPhone home-screen app, Android Chrome): the send-push
// Edge Function's encryption (RFC 8291 / aes128gcm), VAPID signing and safety checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import {
  b64urlDecode, b64urlEncode, encryptPayload, importVapidKey, isAllowedPushEndpoint, parseSubscription,
  vapidAuthorization, webPayload, webPushOutcome,
} from '../functions/_shared/webpush.ts';

// Fixed example (fixed keys + salt). Its output was decrypted correctly by http_ece,
// the reference library by RFC 8188/8291's author, on 21 Nov 2026 (50 random
// messages were also cross-checked). Any change to the encryption breaks this test.
const FIXED = {
  uaPublic: 'BCCFjFepbCEdJ9a0KEQs42dU4FVKV5Fbs3Ie0LW58W-5v5WDTfvp7MEs-_eiiw2FECwStW5d56_a8aYb-_HKggk',
  auth: 'wXjYw00RhQ9L3eR1SyVgCw',   // test-only key, not a secret  gitleaks:allow
  salt: 'Y0ea1poJCyWCd-yPum-ZQQ',
  asJwk: {
    kty: 'EC', crv: 'P-256', ext: true,
    x: 'Advt9KVmrQ2AaTEVZAEwOqnKoFQdVf0EK53I-2BPEes',
    y: 'DDhjJWXMte_4sTKRoFQziXYWrqgeK-elo8syaKV-ZAs',
    d: 'G4PJMARCxQsUHZmlp5AFeLpHWdMzYHq-hMNP6djz_4s',   // test-only key, not a secret  gitleaks:allow
  },
  expected: 'Y0ea1poJCyWCd-yPum-ZQQAAEABBBAHb7fSlZq0NgGkxFWQBMDqpyqBUHVX9BCudyPtgTxHrDDhjJWXMte_4sTKRoFQziXYWrqgeK-elo8syaKV-ZAtnRvJnOJFPbir6F0ChNTARRzJDhRJlHIlM5vXD_JbI3phyuwVORqqJ5WFEBSWNdNL4giOA5PCbvGA6',
};

test('encryption matches the fixed, independently verified example', async () => {
  const { d, ...pub } = FIXED.asJwk;
  const serverKeys = {
    privateKey: await crypto.subtle.importKey('jwk', FIXED.asJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']),
    publicKey: await crypto.subtle.importKey('jwk', { ...pub, key_ops: [] }, { name: 'ECDH', namedCurve: 'P-256' }, true, []),
  };
  assert.ok(d);
  const sub = { endpoint: 'https://web.push.apple.com/QWxs', keys: { p256dh: FIXED.uaPublic, auth: FIXED.auth } };
  const body = await encryptPayload(sub, new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    { salt: b64urlDecode(FIXED.salt), serverKeys });
  assert.equal(b64urlEncode(body), FIXED.expected);
  // header: salt | record size 4096 | key id length 65 | server public key
  assert.equal(new DataView(body.buffer).getUint32(16), 4096);
  assert.equal(body[20], 65);
});

test('every message uses a fresh key and salt (same text never looks the same)', async () => {
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(nodeCrypto.randomBytes(16)) } };
  const a = await encryptPayload(sub, new TextEncoder().encode('same'));
  const b = await encryptPayload(sub, new TextEncoder().encode('same'));
  assert.notEqual(b64urlEncode(a), b64urlEncode(b));
  await assert.rejects(encryptPayload(sub, new Uint8Array(4000)), /too large/);
});

test('only real browser push services can be contacted (no SSRF)', () => {
  for (const ok of ['https://web.push.apple.com/QW1', 'https://fcm.googleapis.com/fcm/send/x', 'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-par02p.notify.windows.com/w/?token=x']) assert.equal(isAllowedPushEndpoint(ok), true, ok);
  for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://evil.com/fcm.googleapis.com',
    'https://169.254.169.254/latest', 'https://localhost/x', 'https://fcm.googleapis.com:8443/x', 'https://user:pw@fcm.googleapis.com/x',
    'https://a.b.notify.windows.com/x', 'javascript:alert(1)', '']) assert.equal(isAllowedPushEndpoint(bad), false, bad);
});

test('stored subscriptions are validated before use', () => {
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const good = { endpoint: 'https://web.push.apple.com/QW1', keys: { p256dh: b64urlEncode(ua.getPublicKey()), auth: b64urlEncode(nodeCrypto.randomBytes(16)) } };
  assert.deepEqual(parseSubscription(good), good);
  assert.equal(parseSubscription({ ...good, endpoint: 'https://evil.com/x' }), null);
  assert.equal(parseSubscription({ ...good, keys: { ...good.keys, auth: 'short' } }), null);
  assert.equal(parseSubscription({ ...good, keys: { ...good.keys, p256dh: '!!' } }), null);
  assert.equal(parseSubscription(null), null);
  assert.equal(parseSubscription('x'), null);
});

test('VAPID: ES256 token for the push service origin, valid 12 hours, verifiable with the public key', async () => {
  const vk = nodeCrypto.createECDH('prime256v1'); vk.generateKeys();
  const pub = b64urlEncode(vk.getPublicKey());
  const key = await importVapidKey(pub, b64urlEncode(vk.getPrivateKey()));
  const hdr = await vapidAuthorization('https://web.push.apple.com/QW1?x=1', 'mailto:owner@example.com', pub, key, 1_800_000_000);
  const [, h, c, s, k] = hdr.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.equal(k, pub);
  assert.deepEqual(JSON.parse(Buffer.from(b64urlDecode(h)).toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(b64urlDecode(c)).toString()), { aud: 'https://web.push.apple.com', exp: 1_800_043_200, sub: 'mailto:owner@example.com' });
  const pk = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(vk.getPublicKey().subarray(1, 33)), y: b64urlEncode(vk.getPublicKey().subarray(33)) }, format: 'jwk' });
  assert.equal(nodeCrypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pk, dsaEncoding: 'ieee-p1363' }, Buffer.from(b64urlDecode(s))), true);
  await assert.rejects(vapidAuthorization('https://web.push.apple.com/x', 'owner', pub, key, 1), /subject/);
  await assert.rejects(importVapidKey('abc', 'def'), /bad VAPID keys/);
});

test('payload is small and carries only title, body and kind; service answers map to actions', () => {
  const p = JSON.parse(new TextDecoder().decode(webPayload('Lunch delivered', 'Enjoy!', { kind: 'meal_delivered', order_id: 'x', notification_id: 'y' })));
  assert.deepEqual(p, { title: 'Lunch delivered', body: 'Enjoy!', kind: 'meal_delivered' });
  assert.equal(webPushOutcome(201), 'ok');
  assert.equal(webPushOutcome(410), 'gone');
  assert.equal(webPushOutcome(404), 'gone');
  assert.equal(webPushOutcome(429), 'retry');
  assert.equal(webPushOutcome(500), 'retry');
});
