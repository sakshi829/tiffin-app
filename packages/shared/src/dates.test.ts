import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, formatDate, formatTime, isIsoDate, isoWeekday, istToday, istToIso, monthRange, parseTime } from './dates.ts';

test('istToday switches date at midnight India time, not UTC', () => {
  assert.equal(istToday(Date.parse('2026-12-01T18:29:00Z')), '2026-12-01'); // 23:59 IST
  assert.equal(istToday(Date.parse('2026-12-01T18:30:00Z')), '2026-12-02'); // 00:00 IST
});

test('addDays crosses months and years', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.throws(() => addDays('2026-02-30', 1));
});

test('isIsoDate rejects impossible dates', () => {
  assert.equal(isIsoDate('2026-12-01'), true);
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('1/12/2026'), false);
});

test('isoWeekday matches the database (Mon=1..Sun=7)', () => {
  assert.equal(isoWeekday('2026-12-01'), 2); // Tuesday
  assert.equal(isoWeekday('2026-12-06'), 7); // Sunday
});

test('formatDate / monthRange', () => {
  assert.equal(formatDate('2026-12-01'), 'Tue, 1 Dec');
  assert.equal(formatDate('2027-01-05', 2026), 'Tue, 5 Jan 2027');
  assert.deepEqual(monthRange('2026-02-14'), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(monthRange('2028-02-14'), { from: '2028-02-01', to: '2028-02-29' });
});

test('istToIso converts India time to UTC', () => {
  assert.equal(istToIso('2026-12-01', '18:00'), '2026-12-01T12:30:00.000Z');
  assert.equal(istToIso('2026-12-01', '03:00'), '2026-11-30T21:30:00.000Z');
  assert.throws(() => istToIso('2026-12-01', '6 pm'));
});

test('time formatting and forgiving parsing', () => {
  assert.equal(formatTime('13:30:00'), '1:30 PM');
  assert.equal(formatTime('00:05'), '12:05 AM');
  assert.equal(parseTime('1:30 pm'), '13:30');
  assert.equal(parseTime('12 am'), '00:00');
  assert.equal(parseTime('9:05AM'), '09:05');
  assert.equal(parseTime('20:30'), '20:30');
  for (const bad of ['25:00', '13:30 pm', '9:75', 'noon', '']) assert.equal(parseTime(bad), null, bad);
});
