/**
 * The console's colour families and the light and dark palette each one paints, data only. `./theme.ts` renders the
 * CSS from `THEME_PALETTES` and keeps the stored choice; this file is where a palette is written.
 */

/** A colour family, the palette pair a theme paints the console in. */
export type ThemeFamily = "teal" | "blue" | "green" | "citron" | "amber" | "red" | "rose" | "purple" | "graphite";

/** Light or dark — the console's own choice, never the system's. */
export type ThemeMode = "light" | "dark";

/** One family. */
export interface ThemeFamilyEntry {
  readonly id: ThemeFamily;
  /** Its name. */
  readonly label: string;
}

/** The nine opaque tokens one palette sets, each an `oklch(L C H)` colour. */
export interface ThemePalette {
  /** `--c-bg`: the page ground. */
  readonly bg: string;
  /** `--c-sidebar`: one step below the ground. */
  readonly sidebar: string;
  /** `--c-card`: one step above the ground. */
  readonly card: string;
  /** `--c-panel`: popovers, muted fills, hovers. */
  readonly panel: string;
  /** `--c-border`. */
  readonly border: string;
  /** `--c-ink`: body text. */
  readonly ink: string;
  /** `--c-muted`: secondary text. */
  readonly muted: string;
  /** `--c-primary`: the accent, links, focus. */
  readonly primary: string;
  /** `--c-primary-ink`: text drawn ON the accent. */
  readonly primaryInk: string;
}

/** Every family. The first is the console as it has always opened. */
export const THEME_FAMILIES = [
  { id: "teal", label: "Teal" },
  { id: "blue", label: "Blue" },
  { id: "green", label: "Green" },
  { id: "citron", label: "Citron" },
  { id: "amber", label: "Amber" },
  { id: "red", label: "Red" },
  { id: "rose", label: "Rose" },
  { id: "purple", label: "Purple" },
  { id: "graphite", label: "Graphite" },
] as const satisfies readonly ThemeFamilyEntry[];

/** Both modes, light first. */
export const THEME_MODES = ["light", "dark"] as const satisfies readonly ThemeMode[];

/**
 * Every family's two palettes. Dark grounds are near-black carrying the family's hue, so a card reads as tinted
 * glass; light grounds are near-white the same way. Four of them keep the themes that came
 * before (teal dark is the original midnight teal, amber dark the warm dark, teal light the paper light,
 * graphite dark the soft grey), so a stored choice migrates to the look it already had.
 */
export const THEME_PALETTES: Readonly<Record<ThemeFamily, Readonly<Record<ThemeMode, ThemePalette>>>> = {
  teal: {
    dark: {
      bg: "oklch(0.145 0.006 250)",
      sidebar: "oklch(0.115 0.006 250)",
      card: "oklch(0.185 0.007 250)",
      panel: "oklch(0.225 0.008 250)",
      border: "oklch(0.3 0.01 250)",
      ink: "oklch(0.94 0.005 250)",
      muted: "oklch(0.7 0.012 250)",
      primary: "oklch(0.72 0.14 185)",
      primaryInk: "oklch(0.15 0.03 185)",
    },
    light: {
      bg: "oklch(0.975 0.01 85)",
      sidebar: "oklch(0.945 0.012 85)",
      card: "oklch(0.995 0.004 85)",
      panel: "oklch(0.925 0.012 85)",
      border: "oklch(0.85 0.015 85)",
      ink: "oklch(0.25 0.015 60)",
      muted: "oklch(0.43 0.02 60)",
      primary: "oklch(0.42 0.1 185)",
      primaryInk: "oklch(0.98 0.01 185)",
    },
  },
  blue: {
    dark: {
      bg: "oklch(0.155 0.02 260)",
      sidebar: "oklch(0.125 0.02 260)",
      card: "oklch(0.195 0.024 260)",
      panel: "oklch(0.235 0.028 260)",
      border: "oklch(0.32 0.03 260)",
      ink: "oklch(0.95 0.008 260)",
      muted: "oklch(0.72 0.03 260)",
      primary: "oklch(0.72 0.13 255)",
      primaryInk: "oklch(0.16 0.04 260)",
    },
    light: {
      bg: "oklch(0.97 0.012 255)",
      sidebar: "oklch(0.94 0.018 255)",
      card: "oklch(0.995 0.004 255)",
      panel: "oklch(0.92 0.02 255)",
      border: "oklch(0.85 0.03 255)",
      ink: "oklch(0.25 0.03 260)",
      muted: "oklch(0.43 0.03 260)",
      primary: "oklch(0.44 0.15 258)",
      primaryInk: "oklch(0.985 0.005 255)",
    },
  },
  green: {
    dark: {
      bg: "oklch(0.155 0.018 155)",
      sidebar: "oklch(0.125 0.016 155)",
      card: "oklch(0.195 0.022 155)",
      panel: "oklch(0.235 0.026 155)",
      border: "oklch(0.32 0.03 155)",
      ink: "oklch(0.95 0.01 150)",
      muted: "oklch(0.73 0.03 150)",
      primary: "oklch(0.76 0.15 150)",
      primaryInk: "oklch(0.17 0.04 155)",
    },
    light: {
      bg: "oklch(0.972 0.014 150)",
      sidebar: "oklch(0.942 0.02 150)",
      card: "oklch(0.995 0.005 150)",
      panel: "oklch(0.922 0.022 150)",
      border: "oklch(0.85 0.03 150)",
      ink: "oklch(0.25 0.03 155)",
      muted: "oklch(0.43 0.03 155)",
      primary: "oklch(0.44 0.12 150)",
      primaryInk: "oklch(0.985 0.008 150)",
    },
  },
  citron: {
    dark: {
      bg: "oklch(0.16 0.016 105)",
      sidebar: "oklch(0.13 0.014 105)",
      card: "oklch(0.2 0.02 105)",
      panel: "oklch(0.24 0.024 105)",
      border: "oklch(0.33 0.03 105)",
      ink: "oklch(0.95 0.015 105)",
      muted: "oklch(0.74 0.035 105)",
      primary: "oklch(0.85 0.15 105)",
      primaryInk: "oklch(0.2 0.04 105)",
    },
    light: {
      bg: "oklch(0.975 0.02 105)",
      sidebar: "oklch(0.945 0.03 105)",
      card: "oklch(0.995 0.008 105)",
      panel: "oklch(0.925 0.035 105)",
      border: "oklch(0.86 0.045 105)",
      ink: "oklch(0.26 0.03 100)",
      muted: "oklch(0.43 0.04 100)",
      primary: "oklch(0.44 0.11 110)",
      primaryInk: "oklch(0.985 0.01 105)",
    },
  },
  amber: {
    dark: {
      bg: "oklch(0.2 0.012 55)",
      sidebar: "oklch(0.165 0.012 55)",
      card: "oklch(0.245 0.014 55)",
      panel: "oklch(0.29 0.016 55)",
      border: "oklch(0.37 0.02 55)",
      ink: "oklch(0.93 0.015 80)",
      muted: "oklch(0.77 0.025 70)",
      primary: "oklch(0.76 0.13 65)",
      primaryInk: "oklch(0.2 0.03 55)",
    },
    light: {
      bg: "oklch(0.972 0.016 70)",
      sidebar: "oklch(0.942 0.024 70)",
      card: "oklch(0.995 0.006 70)",
      panel: "oklch(0.922 0.028 70)",
      border: "oklch(0.85 0.04 70)",
      ink: "oklch(0.26 0.03 55)",
      muted: "oklch(0.43 0.04 55)",
      primary: "oklch(0.44 0.12 55)",
      primaryInk: "oklch(0.985 0.008 70)",
    },
  },
  red: {
    dark: {
      bg: "oklch(0.155 0.02 25)",
      sidebar: "oklch(0.125 0.018 25)",
      card: "oklch(0.195 0.024 25)",
      panel: "oklch(0.235 0.028 25)",
      border: "oklch(0.32 0.035 25)",
      ink: "oklch(0.95 0.01 25)",
      muted: "oklch(0.74 0.03 25)",
      primary: "oklch(0.72 0.16 25)",
      primaryInk: "oklch(0.17 0.04 25)",
    },
    light: {
      bg: "oklch(0.972 0.012 25)",
      sidebar: "oklch(0.942 0.02 25)",
      card: "oklch(0.995 0.004 25)",
      panel: "oklch(0.932 0.024 25)",
      border: "oklch(0.85 0.035 25)",
      ink: "oklch(0.26 0.03 25)",
      muted: "oklch(0.42 0.035 25)",
      primary: "oklch(0.44 0.18 27)",
      primaryInk: "oklch(0.985 0.005 25)",
    },
  },
  rose: {
    dark: {
      bg: "oklch(0.155 0.02 355)",
      sidebar: "oklch(0.125 0.018 355)",
      card: "oklch(0.195 0.024 355)",
      panel: "oklch(0.235 0.028 355)",
      border: "oklch(0.32 0.035 355)",
      ink: "oklch(0.95 0.01 355)",
      muted: "oklch(0.74 0.03 355)",
      primary: "oklch(0.76 0.14 355)",
      primaryInk: "oklch(0.17 0.04 355)",
    },
    light: {
      bg: "oklch(0.972 0.012 355)",
      sidebar: "oklch(0.942 0.02 355)",
      card: "oklch(0.995 0.004 355)",
      panel: "oklch(0.922 0.024 355)",
      border: "oklch(0.85 0.035 355)",
      ink: "oklch(0.26 0.03 355)",
      muted: "oklch(0.43 0.035 355)",
      primary: "oklch(0.44 0.17 355)",
      primaryInk: "oklch(0.985 0.005 355)",
    },
  },
  purple: {
    dark: {
      bg: "oklch(0.155 0.024 300)",
      sidebar: "oklch(0.125 0.022 300)",
      card: "oklch(0.195 0.028 300)",
      panel: "oklch(0.235 0.032 300)",
      border: "oklch(0.32 0.04 300)",
      ink: "oklch(0.95 0.01 300)",
      muted: "oklch(0.74 0.035 300)",
      primary: "oklch(0.74 0.14 300)",
      primaryInk: "oklch(0.17 0.05 300)",
    },
    light: {
      bg: "oklch(0.97 0.014 300)",
      sidebar: "oklch(0.94 0.022 300)",
      card: "oklch(0.995 0.005 300)",
      panel: "oklch(0.92 0.026 300)",
      border: "oklch(0.85 0.04 300)",
      ink: "oklch(0.26 0.035 300)",
      muted: "oklch(0.43 0.04 300)",
      primary: "oklch(0.44 0.17 300)",
      primaryInk: "oklch(0.985 0.006 300)",
    },
  },
  graphite: {
    dark: {
      bg: "oklch(0.26 0.004 250)",
      sidebar: "oklch(0.23 0.004 250)",
      card: "oklch(0.285 0.005 250)",
      panel: "oklch(0.3 0.006 250)",
      border: "oklch(0.42 0.008 250)",
      ink: "oklch(0.91 0.004 250)",
      muted: "oklch(0.81 0.008 250)",
      primary: "oklch(0.76 0.06 230)",
      primaryInk: "oklch(0.2 0.02 230)",
    },
    light: {
      bg: "oklch(0.965 0.002 250)",
      sidebar: "oklch(0.935 0.003 250)",
      card: "oklch(0.99 0.001 250)",
      panel: "oklch(0.915 0.004 250)",
      border: "oklch(0.84 0.006 250)",
      ink: "oklch(0.27 0.006 250)",
      muted: "oklch(0.45 0.008 250)",
      primary: "oklch(0.44 0.06 240)",
      primaryInk: "oklch(0.985 0.002 250)",
    },
  },
};
