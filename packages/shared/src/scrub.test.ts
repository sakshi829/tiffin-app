import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidSentryDsn, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './scrub.ts';

test('free text: emails, phone numbers, tokens and invite codes are removed', () => {
  assert.equal(scrubText('Could not reach priya.k@gmail.com at +91 98200 11111'), 'Could not reach [email] at [number]');
  assert.equal(scrubText('Invite AB3CD-9XY7Z failed'), 'Invite [code] failed');
  assert.equal(scrubText('Authorization: Bearer abc.def-ghi'), 'Authorization: Bearer [token]');
  // nosemgrep: generic.secrets.security.detected-jwt-token.detected-jwt-token -- fake token ({"sub":"1"}, signature "sig_123") to prove tokens are removed
  assert.equal(scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_123'), 'jwt [token]');
  assert.equal(scrubText('ORDER_NOT_ACTIVE at step 3'), 'ORDER_NOT_ACTIVE at step 3');   // ordinary text untouched
});

test('URLs keep only the path', () => {
  assert.equal(scrubUrl('https://abc.supabase.co/rest/v1/customers?phone=eq.9820011111&select=*'), 'https://abc.supabase.co/rest/v1/customers');
  assert.equal(scrubUrl('amrutaskitchen://meal/123#x'), 'amrutaskitchen://meal/123');
});

test('events lose the user, request and extra data; messages and breadcrumbs are scrubbed', () => {
  const out = scrubEvent({
    message: 'Failed for 9820011111',
    user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
    request: { url: 'https://x/y?token=1', headers: { authorization: 'Bearer t' }, data: { phone: '9820011111' } },
    extra: { customer: { full_name: 'Priya' } },
    server_name: 'phone-of-priya',
    contexts: { device: { model: 'Pixel 8', name: "Priya's phone" }, os: { name: 'Android' } },
    exception: { values: [{ type: 'Error', value: 'mail a@b.com failed' }] },
    breadcrumbs: [
      { category: 'console', message: 'customer Priya 9820011111' },
      { category: 'fetch', data: { method: 'GET', url: 'https://x.supabase.co/rest/v1/orders?customer_id=eq.1', status_code: 200, body: 'x' } },
      { category: 'navigation', data: { from: '/customer/1?x=1', to: '/money' } },
    ],
  }) as Record<string, any>;
  assert.equal(out.user, undefined);
  assert.equal(out.request, undefined);
  assert.equal(out.extra, undefined);
  assert.equal(out.server_name, undefined);
  assert.equal(out.message, 'Failed for [number]');
  assert.deepEqual(out.contexts.device, { model: 'Pixel 8', family: undefined, simulator: undefined });   // no device name
  assert.equal(out.exception.values[0].value, 'mail [email] failed');
  assert.deepEqual(out.breadcrumbs, [
    { category: 'fetch', data: { method: 'GET', url: 'https://x.supabase.co/rest/v1/orders', status_code: 200 } },
    { category: 'navigation', data: { to: '/money', from: '/customer/1' } },
  ]);
  assert.equal(scrubBreadcrumb({ category: 'console', message: 'x' }), null);
});

test('only a real-looking Sentry DSN turns reporting on', () => {
  assert.equal(isValidSentryDsn('https://0123456789abcdef0123456789abcdef@o123456.ingest.us.sentry.io/4507000000000000'), true);
  for (const bad of ['', 'http://key@host/1', 'https://host/1', 'https://0123456789abcdef@host/abc', 'javascript:alert(1)']) {
    assert.equal(isValidSentryDsn(bad), false, bad);
  }
});
