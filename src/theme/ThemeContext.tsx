import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors as lightColors } from './theme';

/** Same keys as the light palette, but values widened to `string` so the dark
 *  palette (different hex values) is assignable. */
export type ThemePalette = { [K in keyof typeof lightColors]: string };
export type ThemeMode = 'light' | 'dark';

/**
 * Dark palette. Keys mirror the light palette exactly so every `makeStyles(colors)`
 * factory works unchanged under either theme. Semantics are remapped, not literal:
 * `navy` is the app's primary *text* color, so in dark mode it becomes near-white;
 * `offWhite`/`white` are the screen and card *surfaces*, so they become dark slate.
 */
const darkColors: ThemePalette = {
  navy: '#F1F5F9',
  navyDeep: '#E2E8F0',
  navyMid: '#CBD5E1',

  orange: '#F97316',
  orangeLight: '#FB923C',
  orangeDark: '#FB923C',
  buttonStart: lightColors.buttonStart,
  buttonEnd: lightColors.buttonEnd,

  offWhite: '#0B1220',
  white: '#111C2E',
  gray100: '#1E2A3D',
  gray200: '#2C3A4F',
  gray300: '#3B4A60',
  gray400: '#8595AB',
  textLight: '#94A3B8',
  danger: '#F87171',
  star: '#FACC15',
  brandNavy: lightColors.brandNavy,
  onBrand: lightColors.onBrand,
  onBrandMuted: lightColors.onBrandMuted,
  butter: lightColors.butter,
  onButter: lightColors.onButter,
  butterMuted: lightColors.butterMuted,
  brandLine: lightColors.brandLine,
  accentSoft: '#32271F',
  accentInk: '#FFB37B',
  shadow: '#000000',
  skeletonShine: 'rgba(255,255,255,0.07)',
  overlay: lightColors.overlay,
};

const STORAGE_KEY = 'localgo.theme';

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemePalette;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');

  // Restore the saved preference once on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved === 'light' || saved === 'dark') setModeState(saved);
    });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark: mode === 'dark',
      colors: mode === 'dark' ? darkColors : lightColors,
      toggle: () => setMode(mode === 'dark' ? 'light' : 'dark'),
      setMode,
    }),
    [mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Active theme. Falls back to the light palette if used outside the provider. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      mode: 'light',
      isDark: false,
      colors: lightColors,
      toggle: () => {},
      setMode: () => {},
    };
  }
  return ctx;
}
