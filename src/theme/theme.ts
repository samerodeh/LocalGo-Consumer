/**
 * LocalGO's shared visual system: the original orange/navy brand with
 * refined surfaces, rounded controls, and semantic colors for both themes.
 */
export const colors = {
  navy: '#0F172A',
  navyDeep: '#020617',
  navyMid: '#1E293B',

  orange: '#F97316',
  orangeLight: '#FB923C',
  orangeDark: '#EA580C',
  buttonStart: '#CF4809',
  buttonEnd: '#B83C09',

  offWhite: '#FBFAF7',
  white: '#FFFFFF',
  gray100: '#F3F2EE',
  gray200: '#E8E7E2',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  textLight: '#596579',
  danger: '#DC2626',
  star: '#FACC15',
  brandNavy: '#101D33',
  onBrand: '#FFFFFF',
  onBrandMuted: '#C4CDDA',
  butter: '#F3E5C4',
  onButter: '#252B35',
  butterMuted: '#685C43',
  brandLine: 'rgba(255,255,255,0.12)',
  accentSoft: '#FFF0E5',
  accentInk: '#B84408',
  shadow: '#0F172A',
  skeletonShine: 'rgba(255,255,255,0.65)',
  overlay: 'rgba(2,6,23,0.55)',
} as const;

/** Deeper brand orange keeps white primary-action labels readable. */
export const accentGradient = [colors.buttonStart, colors.buttonEnd] as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
} as const;

/**
 * Barlow Condensed display font families, registered in the root layout via
 * expo-font. Used for logos, section titles, and hero numbers.
 */
export const fonts = {
  displayBlack: 'BarlowCondensed-Black',
  displayExtraBold: 'BarlowCondensed-ExtraBold',
  displayBold: 'BarlowCondensed-Bold',
  displaySemiBold: 'BarlowCondensed-SemiBold',
} as const;
