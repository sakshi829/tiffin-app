// App colour tokens (light + dark). Kept here, free of React Native, so a unit
// test can check every pairing the screens use against WCAG 2.2 contrast:
// 4.5:1 for text, 3:1 for the outline that identifies a control (colors.test.ts).

// Ocean palette (owner's choice, 27 Nov 2026: decision T126). accentSoft / onAccentSoft = the tinted
// highlight (balance card, countdown pill). chartBar is checked for charts on the card colour.
export const lightColors = {
  bg: '#F5F8FB', card: '#FFFFFF', text: '#131A23', muted: '#58616E', border: '#DFE6EE',
  inputBorder: '#858F9B',   // outline of text fields: must reach 3:1 on card and bg
  primary: '#1D5FA8', onPrimary: '#FFFFFF', danger: '#B3261E', onDanger: '#FFFFFF',
  success: '#2E7D32', warning: '#8A5A00', chip: '#E8EFF7', chipActive: '#1D5FA8', onChipActive: '#FFFFFF',
  veg: '#2E7D32', nonVeg: '#B3261E', overlay: 'rgba(0,0,0,0.45)',
  chartBar: '#1D5FA8',
  accentSoft: '#DFEBF8', onAccentSoft: '#174A84',
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  bg: '#0E1218', card: '#171D26', text: '#E8EEF6', muted: '#A2AEBE', border: '#2C3442',
  inputBorder: '#727E8F',
  primary: '#8DB8F0', onPrimary: '#0B1C33', danger: '#F2B8B5', onDanger: '#3A0B08',
  success: '#81C995', warning: '#F2C46B', chip: '#202836', chipActive: '#8DB8F0', onChipActive: '#0B1C33',
  veg: '#81C995', nonVeg: '#F2B8B5', overlay: 'rgba(0,0,0,0.6)',
  chartBar: '#6A9DE0',   // primary is too light for a chart mark on #171D26; this step passes
  accentSoft: '#1C2E48', onAccentSoft: '#C6DCF8',
};

/** WCAG 2.x contrast ratio between two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`not #RRGGBB: ${hex}`);
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Blend two #RRGGBB colours (t = 0 gives a, t = 1 gives b), in sRGB. */
export function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  const k = Math.min(1, Math.max(0, t));
  return '#' + x.map((v, i) => Math.round(v + (y[i]! - v) * k).toString(16).padStart(2, '0')).join('').toUpperCase();
}

export const HEAT_STEPS = 5;

/**
 * Heatmap cell colours: one hue, light (few) to dark (many), in HEAT_STEPS steps,
 * from the chip colour to the chart colour. With the text colour that reads best
 * on each (tested: at least 4.5:1).
 */
export function heatColors(p: Colors): { bg: string; fg: string }[] {
  return Array.from({ length: HEAT_STEPS }, (_, i) => {
    const bg = mixHex(p.chip, p.chartBar, i / (HEAT_STEPS - 1));
    // best of the theme text colours and pure black/white (mid tones need one of the extremes)
    const fg = [p.text, p.onPrimary, '#000000', '#FFFFFF'].reduce((best, c) => (contrastRatio(c, bg) > contrastRatio(best, bg) ? c : best));
    return { bg, fg };
  });
}
