"use client";

/*
 * The four stored choices one theme sets, read and written together: the page's family and mode (`lib/theme.ts`'s
 * keys), and the corner orb's backing and that backing's strength (`lib/voiceStage.ts`'s). Each stays under its own
 * key, so the boot script, `AppearanceSync` and the overlay's orb read a theme exactly as they read anything else
 * stored there. The orb's ramp is not one of them: it is derived from the family and mode worn
 * (`appearanceStylesheet`), so it moves with the page in the same paint.
 *
 * The four writes are not one transaction: `localStorage` has none across keys. They run synchronously in one press,
 * and every other window re-reads storage on each event it hears rather than trusting the event's value, so an open
 * window settles on the whole theme. Where storage refuses writes, `usePreference` falls back to one broadcast per key,
 * and another window can draw a step between two themes for the moment the four take to arrive. A process killed
 * between two writes leaves a mix of two themes, which the Settings modal then shows as worn by none. One stored theme
 * id, with every reader deriving its four values from it, is the shape that would close both; nothing here needs it
 * yet.
 */

import {
  DEFAULT_THEME_FAMILY,
  DEFAULT_THEME_MODE,
  isThemeFamily,
  isThemeMode,
  THEME_FAMILY_STORAGE_KEY,
  THEME_MODE_STORAGE_KEY,
} from "../../lib/theme";
import type { ThemeFamily, ThemeMode } from "../../lib/themePalettes";
import type { ThemePresetValues } from "../../lib/themePresets";
import {
  DEFAULT_ORB_BACKING,
  DEFAULT_ORB_BACKING_OPACITY,
  isOrbBacking,
  isOrbBackingOpacity,
  ORB_BACKING_OPACITY_STORAGE_KEY,
  ORB_BACKING_STORAGE_KEY,
} from "../../lib/voiceStage";
import { storedTheme } from "./AppearanceSync";
import { usePreference } from "./preference";

/** The family an absent key reads as: the earlier `sw-theme` id's while it is still stored, else the default. */
const familyWhenAbsent = (): ThemeFamily => storedTheme().family;

/** The mode an absent key reads as, the same way. */
const modeWhenAbsent = (): ThemeMode => storedTheme().mode;

/**
 * What the page and the corner orb wear now, and the one setter that keeps a whole theme.
 *
 * @returns the four values, and `set`, which writes each under its own key
 */
export function useThemeChoices(): {
  readonly values: ThemePresetValues;
  readonly set: (values: ThemePresetValues) => void;
} {
  const family = usePreference<ThemeFamily>({
    accept: isThemeFamily,
    fallback: DEFAULT_THEME_FAMILY,
    key: THEME_FAMILY_STORAGE_KEY,
    whenAbsent: familyWhenAbsent,
  });
  const mode = usePreference<ThemeMode>({
    accept: isThemeMode,
    fallback: DEFAULT_THEME_MODE,
    key: THEME_MODE_STORAGE_KEY,
    whenAbsent: modeWhenAbsent,
  });
  const backing = usePreference({ accept: isOrbBacking, fallback: DEFAULT_ORB_BACKING, key: ORB_BACKING_STORAGE_KEY });
  const backingOpacity = usePreference({
    accept: isOrbBackingOpacity,
    fallback: DEFAULT_ORB_BACKING_OPACITY,
    key: ORB_BACKING_OPACITY_STORAGE_KEY,
  });
  return {
    set: (values) => {
      family.set(values.family);
      mode.set(values.mode);
      backing.set(values.backing);
      backingOpacity.set(values.backingOpacity);
    },
    values: {
      backing: backing.value,
      backingOpacity: backingOpacity.value,
      family: family.value,
      mode: mode.value,
    },
  };
}
