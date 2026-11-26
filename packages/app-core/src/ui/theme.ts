import { useColorScheme } from 'react-native';
import { darkColors, lightColors, type Colors } from '@amruta/shared';

// The colour values live in @amruta/shared (colors.ts) so their contrast is unit-tested.
export type { Colors };

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? darkColors : lightColors;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
