"use client";

import type { CSSProperties, ReactElement } from "react";

import type { PresenceId } from "../../lib/orbPresence";
import { orbRampStyle } from "../../lib/orbRamp";
import { THEME_PALETTES, type ThemeMode } from "../../lib/themePalettes";
import { presetWorn, THEME_PRESETS, type ThemePreset } from "../../lib/themePresets";
import { CORNER_CALM, orbTuning } from "../../lib/voiceStage";
import { MOOD_RING, OrbBackdrop } from "../voice/orbParts";
import { StageOrb } from "../voice/StageOrb";
import { switchTheme } from "./AppearanceSync";
import { useHydrated } from "./preference";
import { usePresenceChoice } from "./presenceChoice";
import { useThemeChoices } from "./themeChoices";

/** How lit each preview's orbs are: the resting presence, a little brighter than silence so its colours show. */
const PREVIEW_LEVEL = 0.6;

/** The full-screen preview's orb: the stage's calm. */
const STAGE_TUNING: CSSProperties & ReturnType<typeof orbTuning> = orbTuning({
  calm: 1,
  level: PREVIEW_LEVEL,
  mood: "idle",
});

/** The corner preview's orb: the corner's calm, as the corner draws it. */
const CORNER_TUNING: CSSProperties & ReturnType<typeof orbTuning> = orbTuning({
  calm: CORNER_CALM,
  level: PREVIEW_LEVEL,
  mood: "idle",
});

/**
 * A theme's own palette and orb ramp as the custom properties its preview paints with, so each tile shows its theme's
 * page and orb without the page wearing it: the ground, the card under the name, the ink, the accent the idle orb's
 * ring takes, and the two colours the tile's orbs inherit in place of the page's (`site/lib/orbRamp.ts`).
 *
 * @returns an inline style
 */
function paletteStyle({ preset }: { preset: ThemePreset }): CSSProperties & Record<`--${string}`, string> {
  const palette = THEME_PALETTES[preset.family][preset.mode];
  // The stage's ground (`VoiceStage.tsx`): the page's own colour, lit toward the orb, falling off toward the mode's edge.
  const edge: Record<ThemeMode, string> = { dark: "black", light: "white" };
  return {
    ...orbRampStyle({ ramp: preset.ramp }),
    "--c-bg": palette.bg,
    "--c-border": palette.border,
    "--c-card": palette.card,
    "--c-ink": palette.ink,
    "--c-muted": palette.muted,
    "--c-primary": palette.primary,
    "--preview-ground": `radial-gradient(ellipse at 34% 50%, color-mix(in oklch, ${palette.bg} 86%, ${palette.primary}) 0%, ${palette.bg} 55%, color-mix(in oklch, ${palette.bg} 70%, ${edge[preset.mode]}) 100%)`,
  };
}

/**
 * One theme's tile: its preview, its name, and the radio that wears it.
 *
 * The preview pairs the two places the orb lives : the full-screen orb on the theme's own ground without the black shadow, and in its bottom-right corner
 * the corner orb on the dark disc it sits on over every other app, so the pair shows what the same orb looks like on a
 * black background. Both are filled with the presence the owner wears now, lit in this theme's colours.
 *
 * @param preset the theme
 * @param presence what fills both orbs: the one worn now
 * @param worn whether it is the theme the page and the orb wear now
 * @param onWear wears it
 * @returns the tile
 */
function PresetTile({
  preset,
  presence,
  worn,
  onWear,
}: {
  preset: ThemePreset;
  presence: PresenceId;
  worn: boolean;
  onWear: (preset: ThemePreset) => void;
}): ReactElement {
  return (
    <label
      className="grid cursor-pointer gap-0 overflow-hidden rounded-[12px] border-2 border-solid border-transparent bg-(--c-card) text-(--c-ink) shadow-sm hover:border-(--c-border) has-checked:border-(--c-primary) has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
      style={paletteStyle({ preset })}
      data-preset={preset.id}
    >
      <input
        type="radio"
        name="sw-theme-preset"
        value={preset.id}
        checked={worn}
        className="sr-only"
        // Each press wears once: `change` a theme not worn, `click` the worn one. A press on the theme already worn
        // changes no radio, so no `change` fires; it still stores the theme, so a first visit wearing Night sky only by
        // default keeps it once pressed, whatever the default later becomes.
        onChange={() => {
          if (!worn) {
            onWear(preset);
          }
        }}
        onClick={() => {
          if (worn) {
            onWear(preset);
          }
        }}
      />
      <span
        aria-hidden="true"
        data-mood="idle"
        className={`${MOOD_RING} relative block aspect-[16/10] bg-(image:--preview-ground)`}
      >
        <span
          className="absolute top-[12%] left-[10%] aspect-square h-[76%]"
          style={STAGE_TUNING}
          data-ground={preset.mode}
        >
          <StageOrb presence={presence} detail="refined" />
        </span>
        <span className="absolute right-[7%] bottom-[9%] size-12" style={CORNER_TUNING} data-ground="dark">
          <OrbBackdrop shown pressable={false} backing={preset.backing} opacity={preset.backingOpacity} />
          <StageOrb presence={presence} detail="plain" />
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 px-3 py-2 text-[0.85rem] font-medium">
        {preset.name}
        <span className="text-[0.72rem] font-normal text-(--c-muted)">{worn ? "worn now" : preset.mode}</span>
      </span>
    </label>
  );
}

/**
 * The Settings modal's Theme tab: the themes, each a whole appearance, one press wearing all of it — the page's
 * colour, light or dark, the colours the orb is lit in and what the corner orb sits on (`lib/themePresets.ts`). What
 * fills the orb is the Presence tab's and a press here leaves it as it is. There is no apply and no undo: a press is
 * the choice.
 *
 * A press writes `<html>`'s attributes first, through the same `switchTheme` the boot script's choices reach, so the
 * orb's ramp moves with the page in the same paint (`appearanceStylesheet`), then keeps each value under its own key,
 * where the overlay's orb and every other open window hear it (`AppearanceSync`, `usePreference`). Until hydration the
 * tiles are hidden, since the first render reads the defaults rather than what the page wears.
 *
 * @returns the radio group of themes
 */
export function ThemePresets(): ReactElement {
  const choices = useThemeChoices();
  const presence = usePresenceChoice();
  const hydrated = useHydrated();
  const worn = presetWorn({ values: choices.values });
  const wear = (preset: ThemePreset): void => {
    switchTheme({ family: preset.family, mode: preset.mode });
    choices.set(preset);
  };
  return (
    <fieldset className="m-0 grid gap-3 border-0 p-0 data-[hydrated=false]:invisible" data-hydrated={hydrated}>
      <legend className="mb-1 p-0 text-[0.95rem] font-semibold">Theme</legend>
      <p className="m-0 text-[0.85rem] text-muted-foreground">
        One press wears the whole theme: the page&apos;s colour, light or dark, the colours the orb is lit in, and the
        dark disc the corner orb sits on. Each preview is your presence full screen on that theme, with the corner orb
        in its bottom right.
      </p>
      {worn === undefined ? (
        <p className="m-0 text-[0.8rem] text-muted-foreground">
          What you wear now is none of these: its colour and mode were picked one control at a time.
        </p>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
        {THEME_PRESETS.map((preset) => (
          <PresetTile
            key={preset.id}
            preset={preset}
            presence={presence.value}
            worn={preset.id === worn?.id}
            onWear={wear}
          />
        ))}
      </div>
    </fieldset>
  );
}
