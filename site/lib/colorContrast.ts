/**
 * WCAG contrast between two of the console's oklch tokens, computed rather than eyeballed.
 *
 * The stylesheet's palettes are written in oklch (`app/console-tw.css`), and "every ink is measured against its
 * own ground" was a comment until this module: nothing computed it. The conversion is CSS Color 4's OKLab →
 * linear sRGB matrices, then gamma encoded; luminance and ratio are WCAG 2's. A colour past sRGB is drawn two ways
 * — clipped to sRGB on an sRGB screen, clipped to P3 on a wide-gamut Mac's — so both conversions are here
 * (`oklchToSrgb`, `oklchToSrgbOnDisplayP3`) for a caller to measure each. Compositing happens in gamma-encoded sRGB because that is where a
 * browser blends a translucent fill over what is behind it.
 */

/** A colour as the stylesheet writes it: `oklch(L C H)`. */
export interface OklchColor {
  readonly lightness: number;
  readonly chroma: number;
  /** Degrees. */
  readonly hue: number;
}

/** A gamma-encoded sRGB colour, each channel in [0, 1]. */
export interface SrgbColor {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

const OKLCH = /^oklch\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\)$/u;

/**
 * Read an `oklch(L C H)` token, the only colour form the palettes use.
 *
 * @param value the token text, e.g. `oklch(0.72 0.14 185)`
 * @returns the three components
 * @throws naming the value, when it is not that form — a palette entry that cannot be read is a defect in the
 *   palette, never a black to compute a ratio against
 */
export function parseOklch({ value }: { value: string }): OklchColor {
  const match = OKLCH.exec(value.trim());
  if (match === null) {
    throw new Error(`not an oklch(L C H) colour: ${value}`);
  }
  return { chroma: Number(match[2]), hue: Number(match[3]), lightness: Number(match[1]) };
}

/** A 3×3 matrix as three rows, each read against (red, green, blue), (L, a, b) or (l, m, s) in that order. */
export type Rows = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Oklab's `l`, `m`, `s` before the cube, as rows over (L, a, b). */
export const LMS_FROM_OKLAB: Rows = [
  [1, 0.3963377774, 0.2158037573],
  [1, -0.1055613458, -0.0638541728],
  [1, -0.0894841775, -1.291485548],
];

/** Linear sRGB (red, green, blue) as rows over the cubed `l`, `m`, `s`. */
export const LINEAR_SRGB_FROM_LMS: Rows = [
  [4.0767416621, -3.3077115913, 0.2309699292],
  [-1.2684380046, 2.6097574011, -0.3413193965],
  [-0.0041960863, -0.7034186147, 1.707614701],
];

/** Linear Display P3 as rows over linear sRGB. */
export const LINEAR_P3_FROM_SRGB: Rows = [
  [0.8224621, 0.177538, 0],
  [0.0331941, 0.9668058, 0],
  [0.0170827, 0.0723974, 0.9105199],
];

/** Linear sRGB as rows over linear Display P3. */
export const LINEAR_SRGB_FROM_P3: Rows = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
];

/** One row of a matrix applied to a vector. */
function dotRow({ row, vector }: { row: Rows[number]; vector: readonly [number, number, number] }): number {
  return row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2];
}

/**
 * A matrix applied to a vector.
 *
 * @returns the three products, in the rows' order
 */
export function applyRows({
  rows,
  vector,
}: {
  rows: Rows;
  vector: readonly [number, number, number];
}): [number, number, number] {
  return [dotRow({ row: rows[0], vector }), dotRow({ row: rows[1], vector }), dotRow({ row: rows[2], vector })];
}

/**
 * Gamma-encode one linear channel, extended sign-symmetrically past [0, 1] as CSS Color 4 defines it. Increasing
 * everywhere, which is what lets a caller bound an encoded channel by its linear bounds.
 *
 * @returns the encoded channel
 */
export function encodeUnbounded({ linear }: { linear: number }): number {
  const magnitude = Math.abs(linear);
  if (magnitude <= 0.0031308) {
    return 12.92 * linear;
  }
  return Math.sign(linear) * (1.055 * magnitude ** (1 / 2.4) - 0.055);
}

/** Clamp one linear channel into the gamut and gamma-encode it. */
function encodeChannel({ linear }: { linear: number }): number {
  return encodeUnbounded({ linear: Math.min(1, Math.max(0, linear)) });
}

/** Undo the sRGB gamma on one channel, sign-symmetrically so an unclipped channel keeps its true value. */
function decodeChannel({ encoded }: { encoded: number }): number {
  const magnitude = Math.abs(encoded);
  if (magnitude <= 0.04045) {
    return encoded / 12.92;
  }
  return Math.sign(encoded) * ((magnitude + 0.055) / 1.055) ** 2.4;
}

/** Linear sRGB, unclamped: a channel outside [0, 1] is a colour outside the sRGB gamut. */
function oklchToLinearSrgb({ color }: { color: OklchColor }): SrgbColor {
  const radians = (color.hue * Math.PI) / 180;
  const lab = [color.lightness, color.chroma * Math.cos(radians), color.chroma * Math.sin(radians)] as const;
  const [l, m, s] = applyRows({ rows: LMS_FROM_OKLAB, vector: lab });
  const [red, green, blue] = applyRows({ rows: LINEAR_SRGB_FROM_LMS, vector: [l ** 3, m ** 3, s ** 3] });
  return { blue, green, red };
}

/**
 * Convert an oklch colour to what a Display P3 screen — every recent Mac's — draws for it: clipped to the P3 gamut
 * rather than sRGB's, then written back in sRGB's coordinates, CSS Color 4's extended sign-symmetric transfer
 * carrying a channel past [0, 1]. Inside sRGB this is `oklchToSrgb`'s colour; past it, the two screens differ, and
 * `relativeLuminance` reads this one's channels as the luminance that screen shows.
 *
 * @returns the extended sRGB colour
 */
export function oklchToSrgbOnDisplayP3({ color }: { color: OklchColor }): SrgbColor {
  const { red, green, blue } = oklchToLinearSrgb({ color });
  const clip = ({ channel }: { channel: number }): number => Math.min(1, Math.max(0, channel));
  const p3 = applyRows({ rows: LINEAR_P3_FROM_SRGB, vector: [red, green, blue] });
  const clipped = [clip({ channel: p3[0] }), clip({ channel: p3[1] }), clip({ channel: p3[2] })] as const;
  const [r, g, b] = applyRows({ rows: LINEAR_SRGB_FROM_P3, vector: clipped });
  return {
    blue: encodeUnbounded({ linear: b }),
    green: encodeUnbounded({ linear: g }),
    red: encodeUnbounded({ linear: r }),
  };
}

/**
 * Convert an oklch colour to gamma-encoded sRGB, clamping what falls outside the gamut.
 *
 * @returns the sRGB colour a browser draws for it
 */
export function oklchToSrgb({ color }: { color: OklchColor }): SrgbColor {
  const linear = oklchToLinearSrgb({ color });
  return {
    blue: encodeChannel({ linear: linear.blue }),
    green: encodeChannel({ linear: linear.green }),
    red: encodeChannel({ linear: linear.red }),
  };
}

/**
 * WCAG 2 relative luminance of a gamma-encoded sRGB colour.
 *
 * @returns 0 for black through 1 for white
 */
export function relativeLuminance({ color }: { color: SrgbColor }): number {
  return (
    0.2126 * decodeChannel({ encoded: color.red }) +
    0.7152 * decodeChannel({ encoded: color.green }) +
    0.0722 * decodeChannel({ encoded: color.blue })
  );
}

/**
 * The WCAG 2 contrast ratio between two sRGB colours, order-independent.
 *
 * @returns 1 (identical) through 21 (black on white)
 */
export function srgbContrastRatio({
  foreground,
  background,
}: {
  foreground: SrgbColor;
  background: SrgbColor;
}): number {
  const one = relativeLuminance({ color: foreground });
  const two = relativeLuminance({ color: background });
  return (Math.max(one, two) + 0.05) / (Math.min(one, two) + 0.05);
}

/**
 * The WCAG 2 contrast ratio between two oklch colours, as the browser draws them.
 *
 * @returns 1 (identical) through 21 (black on white)
 */
export function contrastRatio({ foreground, background }: { foreground: OklchColor; background: OklchColor }): number {
  return srgbContrastRatio({
    background: oklchToSrgb({ color: background }),
    foreground: oklchToSrgb({ color: foreground }),
  });
}

/**
 * Convert a gamma-encoded sRGB colour to oklch — `oklchToSrgb` the other way, so a brand colour written in hex
 * can be mixed in oklab the way `color-mix(in oklab, …)` mixes it.
 *
 * @returns the oklch colour, hue in degrees from 0 up to 360
 */
export function srgbToOklch({ color }: { color: SrgbColor }): OklchColor {
  const red = decodeChannel({ encoded: color.red });
  const green = decodeChannel({ encoded: color.green });
  const blue = decodeChannel({ encoded: color.blue });
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    chroma: Math.hypot(a, b),
    hue: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360,
    lightness: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
  };
}

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu;

/**
 * Read a `#rrggbb` colour, the form a brand colour is written in.
 *
 * @param value the colour text, e.g. `#F5A3B5`
 * @returns the gamma-encoded colour
 * @throws naming the value, when it is not that form
 */
export function parseHex({ value }: { value: string }): SrgbColor {
  const match = HEX.exec(value.trim());
  if (match === null) {
    throw new Error(`not a #rrggbb colour: ${value}`);
  }
  return {
    blue: Number.parseInt(match[3], 16) / 255,
    green: Number.parseInt(match[2], 16) / 255,
    red: Number.parseInt(match[1], 16) / 255,
  };
}

/**
 * Blend a translucent fill over what is behind it, the way a browser composites in sRGB.
 *
 * @param alpha the fill's opacity, 0 (invisible) through 1 (opaque)
 * @returns the colour the eye sees
 */
export function compositeSrgb({
  foreground,
  background,
  alpha,
}: {
  foreground: SrgbColor;
  background: SrgbColor;
  alpha: number;
}): SrgbColor {
  return {
    blue: foreground.blue * alpha + background.blue * (1 - alpha),
    green: foreground.green * alpha + background.green * (1 - alpha),
    red: foreground.red * alpha + background.red * (1 - alpha),
  };
}
