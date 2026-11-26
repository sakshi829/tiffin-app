import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, istClock, matchesSearch, mealActions, upiPayLink } from './customer.ts';

// Lunch 1 Dec 2026: delivery 13:30 IST (08:00Z), extras cutoff 11:00 (05:30Z), location cutoff 13:00 (07:30Z)
const order = {
  status: 'scheduled' as const, order_date: '2026-12-01',
  delivery_at: '2026-12-01T08:00:00Z', addon_cutoff_at: '2026-12-01T05:30:00Z', location_cutoff_at: '2026-12-01T07:30:00Z',
};
const at = (iso: string) => Date.parse(iso);

test('mealActions follows the same cutoffs as the database', () => {
  const before = mealActions(order, at('2026-12-01T05:29:00Z'), '2026-12-01');
  assert.deepEqual(before, { canChangeExtras: true, canSkipFree: true, canSkipLate: false, canUnskip: false, canSetLocation: true, canMarkBox: false });
  const afterExtras = mealActions(order, at('2026-12-01T05:30:00Z'), '2026-12-01');
  assert.equal(afterExtras.canChangeExtras, false);
  assert.equal(afterExtras.canSkipLate, true);
  assert.equal(afterExtras.canSetLocation, true);
  const afterLocation = mealActions(order, at('2026-12-01T07:30:00Z'), '2026-12-01');
  assert.equal(afterLocation.canSetLocation, false);
  const afterDelivery = mealActions(order, at('2026-12-01T08:00:00Z'), '2026-12-01');
  assert.equal(afterDelivery.canSkipLate, false);
  assert.equal(mealActions({ ...order, status: 'skipped' }, at('2026-12-01T05:00:00Z'), '2026-12-01').canUnskip, true);
  assert.equal(mealActions({ ...order, status: 'skipped_late' }, at('2026-12-01T05:00:00Z'), '2026-12-01').canUnskip, false);
  assert.equal(mealActions({ ...order, status: 'delivered' }, at('2026-12-03T05:00:00Z'), '2026-12-03').canMarkBox, true);
  assert.equal(mealActions({ ...order, status: 'delivered' }, at('2026-12-06T05:00:00Z'), '2026-12-06').canMarkBox, false);
});

test('countdown and India clock', () => {
  const now = at('2026-12-01T03:30:00Z');
  assert.equal(formatCountdown('2026-12-01T05:30:00Z', now), '2 h 00 min');
  assert.equal(formatCountdown('2026-12-01T03:45:00Z', now), '15 min');
  assert.equal(formatCountdown('2026-12-01T03:30:30Z', now), 'less than a minute');
  assert.equal(formatCountdown('2026-12-01T03:00:00Z', now), null);
  assert.equal(formatCountdown('2026-12-03T05:30:00Z', now), '2 d 2 h');
  assert.equal(istClock('2026-12-01T05:30:00Z'), '11:00 AM');
  assert.equal(istClock('2026-12-01T08:00:00Z'), '1:30 PM');
});

test('UPI pay link', () => {
  assert.equal(
    upiPayLink({ upiId: 'amruta@okaxis', payeeName: "Amruta's Kitchen", amountPaise: 120050, note: 'Tiffin Dec' }),
    "upi://pay?pa=amruta%40okaxis&pn=Amruta's%20Kitchen&am=1200.50&cu=INR&tn=Tiffin%20Dec",
  );
  assert.equal(upiPayLink({ upiId: 'not-an-upi', payeeName: 'x', amountPaise: 100, note: '' }), null);
  assert.equal(upiPayLink({ upiId: 'a@b1', payeeName: 'x', amountPaise: 0, note: '' }), null);
});

test('location search is forgiving', () => {
  assert.equal(matchesSearch('City Hospital > Ward 5', 'ward5'), true);
  assert.equal(matchesSearch('City Hospital > Ward 5', 'WARD 5'), true);
  assert.equal(matchesSearch('Pathology Lab', 'ward'), false);
  assert.equal(matchesSearch('anything', ''), true);
});
