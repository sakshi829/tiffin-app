// App colour tokens (light + dark). Kept here, free of React Native, so a unit
// test can check every pairing the screens use against WCAG 2.2 contrast:
// 4.5:1 for text, 3:1 for the outline that identifies a control (colors.test.ts).

const shared = { danger: '#B3261E', onDanger: '#FFFFFF', success: '#2E7D32', warning: '#8A5A00', veg: '#2E7D32', nonVeg: '#B3261E', overlay: 'rgba(0,0,0,0.45)' };
const sharedDark = { danger: '#F2B8B5', onDanger: '#3A0B08', success: '#81C995', warning: '#F2C46B', veg: '#81C995', nonVeg: '#F2B8B5', overlay: 'rgba(0,0,0,0.6)' };

/**
 * Colour palettes (design proposal, Nov 2026). Each has a light and a dark version; every one is
 * contrast-tested (colors.test.ts). accentSoft / onAccentSoft = the tinted highlight (hero card,
 * countdown chip). chartBar is validated for charts on the card colour.
 */
export const PALETTES = {
  saffron: {
    light: { ...shared, bg: '#FAF7F2', card: '#FFFFFF', text: '#1F1A14', muted: '#6B6258', border: '#ECE5DB', inputBorder: '#948A80',
      primary: '#A4491A', onPrimary: '#FFFFFF', chip: '#F3ECE3', chipActive: '#A4491A', onChipActive: '#FFFFFF', chartBar: '#A4491A',
      accentSoft: '#FBE9DD', onAccentSoft: '#7A3311' },
    dark: { ...sharedDark, bg: '#151210', card: '#211C18', text: '#F3EDE6', muted: '#B0A598', border: '#3A322B', inputBorder: '#7D7268',
      primary: '#F0955A', onPrimary: '#1A120C', chip: '#2C2520', chipActive: '#F0955A', onChipActive: '#1A120C', chartBar: '#D97236',
      accentSoft: '#3A2418', onAccentSoft: '#F7C3A0' },
  },
  leaf: {
    light: { ...shared, bg: '#F5F8F5', card: '#FFFFFF', text: '#152019', muted: '#566259', border: '#DFE8E1', inputBorder: '#7D8C82',
      primary: '#1F6B4C', onPrimary: '#FFFFFF', chip: '#E9F1EC', chipActive: '#1F6B4C', onChipActive: '#FFFFFF', chartBar: '#1F6B4C',
      accentSoft: '#DDEFE5', onAccentSoft: '#174F38' },
    dark: { ...sharedDark, bg: '#0F1512', card: '#18201B', text: '#E8F0EA', muted: '#A3B1A7', border: '#2C3830', inputBorder: '#71807A',
      primary: '#7CCBA2', onPrimary: '#0B1F15', chip: '#223029', chipActive: '#7CCBA2', onChipActive: '#0B1F15', chartBar: '#5FAF86',
      accentSoft: '#1E3A2C', onAccentSoft: '#BFE8D2' },
  },
  plum: {
    light: { ...shared, bg: '#FAF6F8', card: '#FFFFFF', text: '#211520', muted: '#675A63', border: '#ECE2E8', inputBorder: '#8F8089',
      primary: '#7A2E5C', onPrimary: '#FFFFFF', chip: '#F3E9EF', chipActive: '#7A2E5C', onChipActive: '#FFFFFF', chartBar: '#7A2E5C',
      accentSoft: '#F6E3EE', onAccentSoft: '#5E2045' },
    dark: { ...sharedDark, bg: '#151013', card: '#211A1F', text: '#F2EAF0', muted: '#B3A3AE', border: '#3A2F37', inputBorder: '#7F717B',
      primary: '#E7A3CB', onPrimary: '#2A0F20', chip: '#2E242B', chipActive: '#E7A3CB', onChipActive: '#2A0F20', chartBar: '#C77AA6',
      accentSoft: '#3A2232', onAccentSoft: '#F5CFE4' },
  },
} as const;

export type PaletteName = keyof typeof PALETTES;
export type Colors = { [K in keyof typeof PALETTES.saffron.light]: string };

/** The palette the apps use (saffron = the original colours until the owner picks). */
export function paletteColors(name: string | undefined, mode: 'light' | 'dark'): Colors {
  const p = name && name in PALETTES ? PALETTES[name as PaletteName] : PALETTES.saffron;
  return p[mode];
}

export const lightColors: Colors = PALETTES.saffron.light;
export const darkColors: Colors = PALETTES.saffron.dark;

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
