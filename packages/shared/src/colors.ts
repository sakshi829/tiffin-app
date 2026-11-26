// App colour tokens (light + dark). Kept here, free of React Native, so a unit
// test can check every pairing the screens use against WCAG 2.2 contrast:
// 4.5:1 for text, 3:1 for the outline that identifies a control (colors.test.ts).

export const lightColors = {
  bg: '#FAF7F2', card: '#FFFFFF', text: '#1F1A14', muted: '#6B6258', border: '#E6DFD5',
  inputBorder: '#948A80',   // outline of text fields: must reach 3:1 on card and bg
  primary: '#A4491A', onPrimary: '#FFFFFF', danger: '#B3261E', onDanger: '#FFFFFF',
  success: '#2E7D32', warning: '#8A5A00', chip: '#F1EBE2', chipActive: '#A4491A', onChipActive: '#FFFFFF',
  veg: '#2E7D32', nonVeg: '#B3261E', overlay: 'rgba(0,0,0,0.45)',
  chartBar: '#A4491A',   // validated for charts (dataviz validator, light surface #FFFFFF)
};

export type Colors = typeof lightColors;

export const darkColors: Colors = {
  bg: '#151210', card: '#211C18', text: '#F3EDE6', muted: '#B0A598', border: '#3A322B',
  inputBorder: '#7D7268',
  primary: '#F0955A', onPrimary: '#1A120C', danger: '#F2B8B5', onDanger: '#3A0B08',
  success: '#81C995', warning: '#F2C46B', chip: '#2C2520', chipActive: '#F0955A', onChipActive: '#1A120C',
  veg: '#81C995', nonVeg: '#F2B8B5', overlay: 'rgba(0,0,0,0.6)',
  chartBar: '#D97236',   // primary is too light for a chart mark on #211C18; this step passes
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
