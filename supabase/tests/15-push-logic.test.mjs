// Unit tests for the send-push Edge Function's decision logic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, chunk, combineResults, readReceipts, safeEqual, summarize } from '../functions/_shared/push.ts';

const T1 = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const T2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

test('one message per device; invalid/duplicate tokens dropped; no device reported', () => {
  const { messages, owners, noDevice } = buildMessages([
    { notification_id: 'n1', title: 'Lunch delivered', body: 'Enjoy', data: { kind: 'meal_delivered' }, tokens: [T1, T2, T1, 'junk'] },
    { notification_id: 'n2', title: 'x', body: 'y', data: null, tokens: [] },
  ]);
  assert.deepEqual(messages.map((m) => m.to), [T1, T2]);
  assert.deepEqual(owners, ['n1', 'n1']);
  assert.deepEqual(noDevice, ['n2']);
  assert.deepEqual(messages[0], { to: T1, title: 'Lunch delivered', body: 'Enjoy', data: { kind: 'meal_delivered' }, sound: 'default', priority: 'high', channelId: 'default' });
});

test('chunks of at most 100 (Expo limit)', () => {
  assert.deepEqual(chunk(Array.from({ length: 250 }, (_, i) => i)).map((c) => c.length), [100, 100, 50]);
});

test('ticket outcomes: any ok = sent; all unregistered = failed (+ remove tokens); otherwise retry', () => {
  const r = summarize([
    { notificationId: 'a', token: T1, ticket: { status: 'ok', id: 'x' } },
    { notificationId: 'a', token: T2, ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
    { notificationId: 'b', token: T2, ticket: { status: 'error', details: { error: 'DeviceNotRegistered' } } },
    { notificationId: 'c', token: T1, ticket: null },
    { notificationId: 'd', token: T1, ticket: { status: 'error', details: { error: 'MessageRateExceeded' } } },
  ], ['e']);
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.deepEqual(by.a, { id: 'a', status: 'sent', invalid_tokens: [T2], tickets: [{ id: 'x', token: T1 }] });
  assert.deepEqual(by.b, { id: 'b', status: 'failed', invalid_tokens: [T2], tickets: [] });
  assert.equal(by.c.status, 'retry');
  assert.equal(by.d.status, 'retry');
  assert.equal(by.e.status, 'no_device');
});

test('receipts: only answered tickets count; DeviceNotRegistered marks the token for removal', () => {
  const r = readReceipts(['t1', 't2', 't3', 't4'], {
    t1: { status: 'ok' },
    t2: { status: 'error', details: { error: 'DeviceNotRegistered' } },
    t3: { status: 'error', details: { error: 'MessageRateExceeded' } },
    // t4: no receipt yet -> asked again later
  });
  assert.deepEqual(r, { checked: ['t1', 't2', 't3'], unregistered: ['t2'] });
  assert.deepEqual(readReceipts(['t1'], null), { checked: [], unregistered: [] });
  assert.deepEqual(readReceipts(['t1'], { t1: { status: 'weird' } }), { checked: [], unregistered: [] });
});

test('phones + browsers: sent if any got it, retry if any may still work, gone browsers removed', () => {
  const expo = [
    { id: 'a', status: 'retry', invalid_tokens: [], tickets: [] },        // phone failed for now, browser ok
    { id: 'b', status: 'failed', invalid_tokens: ['T'], tickets: [] },    // phone uninstalled, browser gone
    { id: 'c', status: 'no_device', invalid_tokens: [], tickets: [] },    // only a browser, which must retry
    { id: 'd', status: 'no_device', invalid_tokens: [], tickets: [] },    // nothing at all
    { id: 'e', status: 'sent', invalid_tokens: [], tickets: [{ id: 'k', token: 'T2' }] },
  ];
  const web = [
    { notificationId: 'a', deviceId: 'w1', outcome: 'ok' },
    { notificationId: 'b', deviceId: 'w2', outcome: 'gone' },
    { notificationId: 'c', deviceId: 'w3', outcome: 'retry' },
    { notificationId: 'e', deviceId: 'w4', outcome: 'gone' },
  ];
  const by = Object.fromEntries(combineResults(expo, web).map((r) => [r.id, r]));
  assert.equal(by.a.status, 'sent');
  assert.deepEqual([by.b.status, by.b.invalid_web], ['failed', ['w2']]);
  assert.equal(by.c.status, 'retry');
  assert.deepEqual([by.d.status, by.d.invalid_web], ['no_device', []]);
  assert.deepEqual([by.e.status, by.e.invalid_web, by.e.tickets], ['sent', ['w4'], [{ id: 'k', token: 'T2' }]]);
});

test('scheduler secret comparison', () => {
  assert.equal(safeEqual('s3cret-value', 's3cret-value'), true);
  assert.equal(safeEqual('s3cret-value', 's3cret-valuX'), false);
  assert.equal(safeEqual('', ''), false, 'an unset secret must never match');
  assert.equal(safeEqual('a', 'ab'), false);
});
