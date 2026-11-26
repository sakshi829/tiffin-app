// Phase 8: browser push subscriptions (web app on iPhone / Android Chrome) in the database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildWorld } from './helpers/world.mjs';
import { rejects } from './helpers/db.mjs';

let w, t, u;
before(async () => { w = await buildWorld(); t = w.t; u = w.u; });
after(async () => { await t.close(); });

const P256 = 'B' + 'A'.repeat(86);            // 87 base64url chars = 65 bytes
const AUTH = 'C'.repeat(22);                   // 22 base64url chars = 16 bytes
const sub = (endpoint, extra = {}) => ({ endpoint, keys: { p256dh: P256, auth: AUTH }, ...extra });
const register = (user, s) => t.call(user, 'public.register_device($1, null, $2::jsonb, $3)', ['web', JSON.stringify(s), 'Safari on iPhone']);

test('a browser subscription is saved trimmed to endpoint + keys', async () => {
  const id = await register(u.custA, sub('https://web.push.apple.com/QWxsIGdvb2Q', { expirationTime: null, extra: 'x'.repeat(50) }));
  const [d] = await t.sql('select platform, expo_push_token, web_push from public.devices where id = $1', [id]);
  assert.deepEqual(d, { platform: 'web', expo_push_token: null, web_push: { endpoint: 'https://web.push.apple.com/QWxsIGdvb2Q', keys: { p256dh: P256, auth: AUTH } } });
  // registering again (same browser) updates the same row
  assert.equal(await register(u.custA, sub('https://web.push.apple.com/QWxsIGdvb2Q')), id);
});

test('only real push services and well-formed keys are accepted (no SSRF through the push sender)', async () => {
  for (const bad of [
    sub('https://evil.example/push'), sub('http://fcm.googleapis.com/fcm/send/x'), sub('https://fcm.googleapis.com.evil.com/x'),
    sub('https://169.254.169.254/latest/meta-data'), sub('https://localhost/x'), sub('https://fcm.googleapis.com:8443/x'),
    sub('https://a.b.notify.windows.com/x'), sub('https://fcm.googleapis.com/ has space'),
    { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: 'short', auth: AUTH } },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/x', keys: { p256dh: P256, auth: 'AAAA' } },
    { endpoint: 'https://fcm.googleapis.com/fcm/send/x' }, { anything: true },
  ]) {
    await rejects(register(u.custB, bad), 'INVALID_REQUEST');
  }
  // exactly one of phone token / browser subscription
  await rejects(t.call(u.custB, 'public.register_device($1, $2, $3::jsonb, null)',
    ['web', 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', JSON.stringify(sub('https://fcm.googleapis.com/fcm/send/ok'))]), 'INVALID_REQUEST');
  await rejects(t.call(u.custB, 'public.register_device($1, null, null, null)', ['web']), 'INVALID_REQUEST');
  for (const ok of ['https://fcm.googleapis.com/fcm/send/abc:DEF_123', 'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=AwYAAAB']) {
    await register(u.custB, sub(ok));
  }
});

test('the push sender receives browser subscriptions; gone ones are removed, nothing else', async () => {
  await t.sql('delete from public.devices');
  const web = await register(u.custA, sub('https://web.push.apple.com/AAA'));
  await t.call(u.custA, 'public.register_device($1, $2, null, null)', ['android', 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]']);
  await t.sql(`select app.notify($1, $2, 'announcement', 'Hello', 'Kitchen closed Sunday', '{}'::jsonb, $3)`, [w.k1, u.custA.id, 'web-' + randomUUID()]);
  const rows = await t.asService('select * from public.push_claim(50)');
  const mine = rows.find((r) => r.title === 'Hello');
  assert.deepEqual(mine.tokens, ['ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]']);
  assert.deepEqual(mine.web, [{ device_id: web, sub: { endpoint: 'https://web.push.apple.com/AAA', keys: { p256dh: P256, auth: AUTH } } }]);
  await rejects(t.as(u.owner, 'select * from public.push_claim(5)'), 'permission denied');
  const phoneId = (await t.sql(`select id from public.devices where expo_push_token is not null`))[0].id;
  await t.asService('select public.push_complete($1::jsonb)', [JSON.stringify([
    { id: mine.notification_id, status: 'sent', invalid_tokens: [], tickets: [], invalid_web: [web, phoneId, 'not-a-uuid'] }])]);
  // the browser subscription is gone; the phone (not a web device) is untouched
  assert.deepEqual((await t.sql('select platform from public.devices order by platform')).map((r) => r.platform), ['android']);
  assert.equal((await t.sql('select push_status from public.notifications where id = $1', [mine.notification_id]))[0].push_status, 'sent');
});

test('a browser that moves to another person stops getting the first person\'s alerts', async () => {
  await t.sql('delete from public.devices');
  await register(u.custA, sub('https://fcm.googleapis.com/fcm/send/shared-laptop'));
  await register(u.custB, sub('https://fcm.googleapis.com/fcm/send/shared-laptop'));
  assert.deepEqual((await t.sql('select user_id from public.devices')).map((r) => r.user_id), [u.custB.id]);
});
