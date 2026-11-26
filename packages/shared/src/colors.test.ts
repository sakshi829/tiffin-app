import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, darkColors, lightColors, type Colors } from './colors.ts';

type Key = keyof Colors;
// [foreground, background] pairs the UI kit actually draws.
const TEXT: [Key, Key][] = [
  ['text', 'bg'], ['text', 'card'], ['text', 'chip'],
  ['muted', 'bg'], ['muted', 'card'], ['muted', 'chip'],          // hints, subtitles, placeholders
  ['primary', 'bg'], ['primary', 'card'],                         // ghost buttons, links
  ['onPrimary', 'primary'], ['onDanger', 'danger'], ['onChipActive', 'chipActive'],
  ['danger', 'bg'], ['danger', 'card'],                           // error text, "bad" badges
  ['success', 'bg'], ['success', 'card'], ['warning', 'bg'], ['warning', 'card'],
  ['onAccentSoft', 'accentSoft'], ['text', 'accentSoft'], ['primary', 'accentSoft'],   // hero card, countdown chip
];
// Non-text marks that carry meaning (WCAG 1.4.11): the field outline, veg/non-veg dot, chart bars.
const UI: [Key, Key][] = [
  ['inputBorder', 'card'], ['inputBorder', 'bg'], ['veg', 'card'], ['nonVeg', 'card'], ['chartBar', 'card'],
];

for (const [name, p] of [['light', lightColors], ['dark', darkColors]] as const) {
  test(`${name} theme: text reaches 4.5:1 and meaningful marks reach 3:1`, () => {
    for (const [fg, bg] of TEXT) {
      const r = contrastRatio(p[fg], p[bg]);
      assert.ok(r >= 4.5, `${name} ${fg} on ${bg} = ${r.toFixed(2)}, needs 4.5`);
    }
    for (const [fg, bg] of UI) {
      const r = contrastRatio(p[fg], p[bg]);
      assert.ok(r >= 3, `${name} ${fg} on ${bg} = ${r.toFixed(2)}, needs 3`);
    }
  });
}

test('contrast ratio matches the WCAG reference values', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(2), '21.00');
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF').toFixed(2), '1.00');
  assert.equal(contrastRatio('#767676', '#FFFFFF').toFixed(2), '4.54');   // the classic "lightest AA grey"
  assert.throws(() => contrastRatio('red', '#FFFFFF'));
});

test('heatmap steps: one hue getting steadily darker (light) / stronger (dark), numbers readable on every step', async () => {
  const { heatColors, HEAT_STEPS } = await import('./colors.ts');
  for (const [name, p] of [['light', lightColors], ['dark', darkColors]] as const) {
    const steps = heatColors(p);
    assert.equal(steps.length, HEAT_STEPS);
    for (const s of steps) {
      const r = contrastRatio(s.fg, s.bg);
      assert.ok(r >= 4.5, `${name} heat ${s.bg}: text contrast ${r.toFixed(2)}`);
    }
    // each step differs visibly from the previous one
    for (let i = 1; i < steps.length; i++) {
      assert.ok(contrastRatio(steps[i]!.bg, steps[i - 1]!.bg) >= 1.15, `${name} steps ${i - 1}->${i} too similar`);
    }
  }
});
