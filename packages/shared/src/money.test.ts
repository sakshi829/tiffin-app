import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRupees, parseRupeesToPaise, isValidPaise } from './money.ts';

test('formatRupees uses Indian grouping and hides zero paise', () => {
  assert.equal(formatRupees(8000), '₹80');
  assert.equal(formatRupees(12345), '₹123.45');
  assert.equal(formatRupees(123456789), '₹12,34,567.89');
  assert.equal(formatRupees(-500), '-₹5');
  assert.equal(formatRupees(8000, { alwaysShowPaise: true }), '₹80.00');
});

test('formatRupees rejects non-integer or unsafe values', () => {
  assert.throws(() => formatRupees(1.5));
  assert.throws(() => formatRupees(Number.NaN));
});

test('parseRupeesToPaise accepts normal input', () => {
  assert.equal(parseRupeesToPaise('80'), 8000);
  assert.equal(parseRupeesToPaise('120.5'), 12050);
  assert.equal(parseRupeesToPaise('₹1,200.50'), 120050);
  assert.equal(parseRupeesToPaise(' 0.05 '), 5);
});

test('parseRupeesToPaise rejects ambiguous or hostile input', () => {
  for (const bad of ['', '-5', '1.234', 'abc', '1e5', '12.', '.5', '9999999999', '1 2']) {
    assert.equal(parseRupeesToPaise(bad), null, `should reject "${bad}"`);
  }
});

test('isValidPaise', () => {
  assert.equal(isValidPaise(100), true);
  assert.equal(isValidPaise(0.1), false);
  assert.equal(isValidPaise('100'), false);
});
