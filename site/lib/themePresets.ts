/**
 * The console's themes: a handful of whole appearances, each one colour family, light or dark, the two colours the orb
 * is lit in and what the corner orb sits on, picked together so they already look right together. One click on the
 * Settings modal's Theme tab wears all of it. What fills the orb is the Presence tab's, apart from this
 * (`./orbPresence.ts`): the presence choice sticks and the theme supplies its colours.
 *
 * Nine colours, light and dark and a glassiness percentage is confusing, and every combination can never be made to
 * look right, so they are bundled into six options that are already agreed to look right, applied the moment the owner
 * picks one, like the orb picker: no undo button, no apply button. So there is no colour, mode, ramp or backing
 * control anywhere else. There is no glassiness at all: every surface is opaque, a hundred percent opacity being the
 * default for everything.
 *
 * That is the shape the two apps the owner named settle on: Claude Code's `/theme` is six whole themes — dark and
 * light, each plain, colour-blind-friendly or the terminal's own colours — previewed in its picker and applied the
 * moment one is chosen; ChatGPT keeps appearance on its Settings page (light, dark or the system's, and a handful of
 * accent colours), never beside the chat.
 *
 * Every theme's corner is the dark disc at full strength: the orb sits over every other app on the owner's screen, and
 * a black background with the colours on top works for most scenarios, being the one ground no orb colour clashes
 * with.
 *
 * A theme's ramp is not stored: it is derived from the family and mode worn (`appearanceStylesheet`, `./theme.ts`), so
 * the boot script, the overlay and every orb read it off the page with nothing new to keep. Pure: the page that offers
 * them is `components/console/ThemePresets.tsx`, and the values each writes are the keys `./theme.ts` and
 * `./voiceStage.ts` already keep.
 */
import { DEFAULT_ORB_RAMP, type OrbRamp } from "./orbRamp";
import type { ThemeFamily, ThemeMode } from "./themePalettes";
import type { OrbBacking, OrbBackingOpacity } from "./voiceStage";

/** Every theme's id, in the order the page shows them. */
export const THEME_PRESET_IDS = ["night-sky", "deep-sea", "ember", "dusk", "daylight", "graphite"] as const;

/** One of {@link THEME_PRESET_IDS}. */
export type ThemePresetId = (typeof THEME_PRESET_IDS)[number];

/** Everything one theme sets, each through its own key. */
export interface ThemePresetValues {
  readonly family: ThemeFamily;
  readonly mode: ThemeMode;
  readonly backing: OrbBacking;
  readonly backingOpacity: OrbBackingOpacity;
}

/** One theme on the page. */
export interface ThemePreset extends ThemePresetValues {
  readonly id: ThemePresetId;
  /** Its name on the page. */
  readonly name: string;
  /** The two colours it lights the orb in, whichever presence fills it. */
  readonly ramp: OrbRamp;
}

/** The corner every theme shares: the dark disc, at full strength. */
const BLACK_CORNER = { backing: "disc", backingOpacity: "100" } as const satisfies Pick<
  ThemePresetValues,
  "backing" | "backingOpacity"
>;

/** The amber sparks' ramp, worn by two themes. */
const SPARK_RAMP: OrbRamp = { dark: "#D9771A", light: "#FFD27A" };

/**
 * The themes, in page order. The first is the console's first visit: the blue-tinted dark that looks right under the
 * full-screen orb, lit in the star cluster's blue and cream on black. The second is the sun's gold on the dark teal.
 * The rest light the orb in colours their own family sits
 * beside, so the orb reads as part of the page rather than against it: amber sparks on amber, lavender on purple, the
 * sparks again on the one light theme, drawn there as colour on paper rather than light on black (`rampTable`,
 * `./orbRamp.ts`): a black-to-white ramp reads badly on the pale page. The last is the plain
 * dark, a cool steel on graphite.
 *
 * Bright teal on black is in none of them: laser-beam teal is hard on the eyes. A theme is a combination already
 * agreed to look right, never a way to reach every colour.
 */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { ...BLACK_CORNER, family: "blue", id: "night-sky", mode: "dark", name: "Night sky", ramp: DEFAULT_ORB_RAMP },
  {
    ...BLACK_CORNER,
    family: "teal",
    id: "deep-sea",
    mode: "dark",
    name: "Deep sea",
    ramp: { dark: "#A36A00", light: "#FFD54A" },
  },
  { ...BLACK_CORNER, family: "amber", id: "ember", mode: "dark", name: "Ember", ramp: SPARK_RAMP },
  {
    ...BLACK_CORNER,
    family: "purple",
    id: "dusk",
    mode: "dark",
    name: "Dusk",
    ramp: { dark: "#5A6488", light: "#C9C8E6" },
  },
  { ...BLACK_CORNER, family: "graphite", id: "daylight", mode: "light", name: "Daylight", ramp: SPARK_RAMP },
  {
    ...BLACK_CORNER,
    family: "graphite",
    id: "graphite",
    mode: "dark",
    name: "Graphite",
    ramp: { dark: "#6E7787", light: "#E6E9EF" },
  },
];

/**
 * The theme whose every value is the one given — the one the page shows as worn.
 *
 * @param values what the page and the orb wear now, each read through its own key
 * @returns the theme, or `undefined` when what is worn is none of them (a family and mode set by hand, say)
 */
export function presetWorn({ values }: { values: ThemePresetValues }): ThemePreset | undefined {
  return THEME_PRESETS.find(
    (preset) =>
      preset.family === values.family &&
      preset.mode === values.mode &&
      preset.backing === values.backing &&
      preset.backingOpacity === values.backingOpacity,
  );
}
