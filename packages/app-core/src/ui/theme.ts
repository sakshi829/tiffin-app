import { useColorScheme } from 'react-native';
import { paletteColors, type Colors } from '@amruta/shared';

// The colour values live in @amruta/shared (colors.ts) so their contrast is unit-tested.
export type { Colors };

/** Which palette the build uses (EXPO_PUBLIC_PALETTE = saffron | leaf | plum; default saffron). */
const PALETTE = process.env.EXPO_PUBLIC_PALETTE;

export function useColors(): Colors {
  return paletteColors(PALETTE, useColorScheme() === 'dark' ? 'dark' : 'light');
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Corner radii: cards and sheets are rounder than buttons; pills are fully round. */
export const radius = { sm: 10, md: 14, lg: 18, pill: 999 } as const;

/** Soft, layered shadow for cards (one subtle edge + one wide, faint lift). */
export function cardShadow(dark: boolean): string {
  return dark ? '0 1px 0 rgba(255,255,255,0.04), 0 6px 18px rgba(0,0,0,0.35)' : '0 1px 2px rgba(31,26,20,0.06), 0 6px 20px rgba(31,26,20,0.07)';
}
