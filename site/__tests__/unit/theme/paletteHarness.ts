/*
 * The colour primitives the theme tests share: every family × mode pair, both renderings, the opaque planes, and
 * the ratio between two palette tokens.
 */

import {
  type OklchColor,
  oklchToSrgb,
  oklchToSrgbOnDisplayP3,
  parseOklch,
  type SrgbColor,
  srgbContrastRatio,
} from "../../../lib/colorContrast";
import { THEME_FAMILIES, THEME_MODES, THEME_PALETTES } from "../../../lib/themePalettes";

/** Every family × mode pair, flattened for the per-palette checks. */
export const PAIRS = THEME_FAMILIES.flatMap((family) =>
  THEME_MODES.map((mode) => ({ family: family.id, mode, palette: THEME_PALETTES[family.id][mode] })),
);

/**
 * The browser wallpaper's three glows, `body`'s radial gradients in `console-tw.css`, top first as CSS lists them:
 * the accent rotated by `hueShift` at `alpha`% at the centre, fading linearly to nothing at `stop`% of an ellipse
 * `size` vmax across, centred `at` per cent of the viewport (the wallpaper is `fixed`). "renders the wallpaper this
 * file measures" finds each one in the stylesheet, so a moved gradient reddens there instead of leaving the
 * page-column test measuring a wallpaper nobody draws.
 */
export const WALLPAPER_GLOWS = [
  { alpha: 42, at: [8, 4], hueShift: 0, size: [60, 50], stop: 70 },
  { alpha: 34, at: [96, 92], hueShift: 70, size: [55, 45], stop: 70 },
  { alpha: 18, at: [55, 45], hueShift: -50, size: [40, 30], stop: 75 },
] as const;

/**
 * The strongest tint of a verdict colour the site lays under a word in that same colour, as a fraction: a
 * `bg-danger/15 text-danger` chip, a badge on hover. The source scan below holds every `bg-<verdict>/N` under it,
 * a solid fill aside.
 */
export const OWN_TINT_MAX = 0.15;

/**
 * The two screens a colour past sRGB is drawn differently on: an sRGB one clips it to sRGB, the Display P3 one
 * every recent Mac has clips it to P3. Several verdict colours, accents and glows are past sRGB, so every contrast
 * test measures both.
 */
export const RENDERINGS = ["srgb", "display-p3"] as const;

/**
 * An oklch colour as one screen draws it.
 *
 * @returns the colour clipped to the given screen's gamut
 */
export function drawn({ color, rendering }: { color: OklchColor; rendering: (typeof RENDERINGS)[number] }): SrgbColor {
  if (rendering === "display-p3") {
    return oklchToSrgbOnDisplayP3({ color });
  }
  return oklchToSrgb({ color });
}

/**
 * A palette token as one rendering draws it.
 *
 * @returns the token's colour on the given screen
 */
export function srgb({ value, rendering }: { value: string; rendering: (typeof RENDERINGS)[number] }): SrgbColor {
  return drawn({ color: parseOklch({ value }), rendering });
}

/**
 * The opaque surfaces text is drawn on, each a palette token: the four planes `console-tw.css`'s glass classes fill
 * with, a control nested in any of them being the page's ground (`.sw-glass-control`). "fills every surface with an
 * opaque palette token" holds the stylesheet to this list.
 */
export const PLANES = ["card", "panel", "sidebar", "bg"] as const;

/**
 * `color-mix(in oklab, a share%, b)`: straight lines in oklab, so a mix with a grey never turns the hue.
 *
 * @returns the mixed colour
 */
export function mixOklab({ a, b, share }: { a: OklchColor; b: OklchColor; share: number }): OklchColor {
  const lab = ({ chroma, hue, lightness }: OklchColor): { l: number; x: number; y: number } => ({
    l: lightness,
    x: chroma * Math.cos((hue * Math.PI) / 180),
    y: chroma * Math.sin((hue * Math.PI) / 180),
  });
  const one = lab(a);
  const two = lab(b);
  const x = one.x * share + two.x * (1 - share);
  const y = one.y * share + two.y * (1 - share);
  return {
    chroma: Math.hypot(x, y),
    hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360,
    lightness: one.l * share + two.l * (1 - share),
  };
}

/** A box of colours: each channel within `low`..`high` of that channel. */
export interface ColourBox {
  readonly low: SrgbColor;
  readonly high: SrgbColor;
}

/**
 * WCAG's ratio from two luminances already computed — the sampled tests compare one ground against many inks.
 *
 * @returns the contrast ratio, at least 1
 */
export function luminanceRatio({ one, two }: { one: number; two: number }): number {
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/**
 * The ratio between two palette tokens, the lower of the two renderings'.
 *
 * @returns the worse contrast ratio across both screens
 */
export function ratio({ foreground, background }: { foreground: string; background: string }): number {
  return Math.min(
    ...RENDERINGS.map((rendering) =>
      srgbContrastRatio({
        background: srgb({ rendering, value: background }),
        foreground: srgb({ rendering, value: foreground }),
      }),
    ),
  );
}
