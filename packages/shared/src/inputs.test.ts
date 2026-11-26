import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNumericInput as clean, numericInputProblem as problem } from './inputs.ts';
import { parseRupeesToPaise } from './money.ts';

test('money boxes keep digits and one point with 2 decimals; letters and symbols are dropped', () => {
  assert.equal(clean('money', '15'), '15');
  assert.equal(clean('money', '1a5b'), '15');
  assert.equal(clean('money', 'abc'), '');
  assert.equal(clean('money', '₹1,200.50'), '1200.50');
  assert.equal(clean('money', '12.345'), '12.34');
  assert.equal(clean('money', '1.2.3'), '1.23');
  assert.equal(clean('money', '-50'), '50');          // plain amounts are never negative
  assert.equal(clean('money', '1234567890123'), '12345678');
  assert.equal(clean('money', '450.'), '450.');       // allowed while typing, flagged below
});

test('signed amounts (statement adjustment) may start with a minus, nothing else changes', () => {
  assert.equal(clean('signed-money', '-50'), '-50');
  assert.equal(clean('signed-money', '−50.5'), '-50.5');   // typographic minus from a paste
  assert.equal(clean('signed-money', '5-0'), '50');
  assert.equal(clean('signed-money', 'x-12'), '12');
});

test('quantities allow 3 decimals; whole numbers allow digits only; phones allow + only at the start', () => {
  assert.equal(clean('quantity', '0.1255kg'), '0.125');
  assert.equal(clean('integer', '1O'), '1');
  assert.equal(clean('integer', '-5'), '5');
  assert.equal(clean('integer', '2.5'), '25');
  assert.equal(clean('phone', '+91 98200-11111'), '+91 98200-11111');
  assert.equal(clean('phone', '98200a11111'), '9820011111');
  assert.equal(clean('phone', '98+200'), '98200');
  assert.equal(clean('phone', '  +91  9820'), '+91 9820');
});

test('problems: unfinished decimals and out-of-range whole numbers', () => {
  assert.equal(problem('money', ''), null);
  assert.equal(problem('money', '450'), null);
  assert.equal(problem('money', '450.'), 'unfinished');
  assert.equal(problem('money', '.'), 'unfinished');
  assert.equal(problem('signed-money', '-'), 'unfinished');
  assert.equal(problem('signed-money', '-12.5'), null);
  assert.equal(problem('integer', '4', { min: 5, max: 500 }), 'range');
  assert.equal(problem('integer', '501', { min: 5, max: 500 }), 'range');
  assert.equal(problem('integer', '30', { min: 5, max: 500 }), null);
  assert.equal(problem('phone', '+'), null);
  assert.equal(problem('money', '10000000'), null);        // exactly ₹1 crore is the ceiling
  assert.equal(problem('money', '10000000.01'), 'too-large');
  assert.equal(problem('signed-money', '-99999999'), 'too-large');
});

test('every finished money value the box allows is accepted by the real parser (no box/parser mismatch)', () => {
  for (const raw of ['0', '15', '15.5', '15.50', '1200', '10000000', '₹1,200.50', '7.07']) {
    const v = clean('money', raw);
    assert.equal(problem('money', v), null, raw);
    assert.notEqual(parseRupeesToPaise(v), null, `${raw} -> ${v}`);
  }
});
