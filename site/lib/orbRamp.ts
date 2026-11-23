/**
 * The orb's colour: a gradient map the theme supplies, laid over whichever presence is drawn.
 *
 * Every presence (`./orbPresence.ts`) is drawn as additive grey light, and the canvas wears one SVG filter that lays
 * the frame on black and reads each pixel's brightness through black → the ramp's dark colour → its light colour →
 * white, so faint light takes the darker colour, gathered light the lighter one and the hottest spots go white. That
 * is how the ElevenLabs widget colours its orb, and it is why no two of the orb's colours can clash: there are only
 * two, and brightness walks between them. On a light page the walk is inked instead ({@link rampTable}): faint light
 * the light colour as a tint, gathered light the dark one, with no black or white, since neither holds on a pale
 * ground.
 *
 * **The theme supplies the pair, the presence never does.** The presence and the theme
 * are decoupled: the presence choice sticks and the theme supplies its colours. So the pair is two inherited CSS
 * custom properties, {@link ORB_RAMP_DARK_PROPERTY} and {@link ORB_RAMP_LIGHT_PROPERTY}: the appearance stylesheet
 * sets them per theme on `<html>` (`./theme.ts`), a Settings theme tile overrides them on itself so its preview wears
 * its own theme, and the orb reads them off its own canvas each frame.
 *
 * **The states change brightness, not hue.** The owner's colour and the voice's must stay clearly
 * distinct. Here that is the brightness: while the owner talks the orb dims toward its darker colour, while the voice talks
 * it burns toward white ({@link rampGainOf}) — on a light page, fainter toward the tint and deeper toward the dark
 * colour.
 *
 * Pure, and imports nothing at run time, so `./theme.ts` and `./themePresets.ts` can both read it.
 */
import type { OrbMood } from "./orbMood";

/** A theme's two orb colours, as `#rrggbb`: the darker one faint light takes, then the lighter one gathered light takes. */
export interface OrbRamp {
  readonly dark: string;
  readonly light: string;
}

/** The custom property carrying the ramp's dark colour. */
export const ORB_RAMP_DARK_PROPERTY = "--sw-orb-ramp-dark";

/** The custom property carrying the ramp's light colour. */
export const ORB_RAMP_LIGHT_PROPERTY = "--sw-orb-ramp-light";

/**
 * The ramp an orb wears where no theme names one: Night sky's ice-blue round a warm-white core, the first theme and a
 * first visit's. The stylesheet sets it on the bare `:root`, so a family and mode no theme pairs still colours the orb.
 */
export const DEFAULT_ORB_RAMP: OrbRamp = { dark: "#5B86D8", light: "#F4E6C8" };

/** A colour exactly as a ramp is written: `#` and six hex digits. */
const HEX_COLOUR = /^#[0-9a-f]{6}$/iu;

/**
 * Whether a string is a ramp colour.
 *
 * @returns true for `#` and six hex digits, nothing else
 */
export function isRampColour({ value }: { value: string }): boolean {
  return HEX_COLOUR.test(value);
}

/**
 * The ramp a canvas reads off its custom properties. A pair that is not two `#rrggbb` colours — a canvas outside any
 * themed page, or a value mangled on its way — is the default ramp, whole, never half of one theme and half of another.
 *
 * @param dark the dark property's value, as read
 * @param light the light property's value, as read
 * @returns the ramp to draw
 */
export function orbRampFromCss({ dark, light }: { dark: string; light: string }): OrbRamp {
  const darkColour = dark.trim();
  const lightColour = light.trim();
  if (!isRampColour({ value: darkColour }) || !isRampColour({ value: lightColour })) {
    return DEFAULT_ORB_RAMP;
  }
  return { dark: darkColour, light: lightColour };
}

/**
 * A ramp as CSS declarations, for the stylesheet a theme writes it into.
 *
 * @returns the two declarations, each ending in `;`
 */
export function orbRampDeclarations({ ramp }: { ramp: OrbRamp }): string {
  return `${ORB_RAMP_DARK_PROPERTY}:${ramp.dark};${ORB_RAMP_LIGHT_PROPERTY}:${ramp.light};`;
}

/**
 * A ramp as an inline style, for an element that wears a theme its page does not — a Settings theme tile.
 *
 * @returns the two custom properties
 */
export function orbRampStyle({ ramp }: { ramp: OrbRamp }): Readonly<Record<`--${string}`, string>> {
  return { [ORB_RAMP_DARK_PROPERTY]: ramp.dark, [ORB_RAMP_LIGHT_PROPERTY]: ramp.light };
}

/**
 * A `#rrggbb` colour as three channels, each 0 to 1.
 *
 * @param hex the colour, `#` and six hex digits
 * @returns red, green and blue
 */
export function hexChannels({ hex }: { hex: string }): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A ramp as channels, so a change of theme can ease from one to the next. */
export interface RampChannels {
  readonly dark: readonly number[];
  readonly light: readonly number[];
}

/**
 * A ramp's two colours as channels.
 *
 * @returns the dark and light colours, each red, green and blue 0 to 1
 */
export function rampChannels({ ramp }: { ramp: OrbRamp }): RampChannels {
  return { dark: hexChannels({ hex: ramp.dark }), light: hexChannels({ hex: ramp.light }) };
}

/**
 * How bright the grey orb is pushed before its ramp: dimmer while the owner talks, so it leans to its darker colour, and
 * burning hotter while the voice does, so it leans to white. Every other state is the ramp as the theme gives it.
 *
 * @returns the gain, 0.8 to 1.2
 */
export function rampGainOf({ mood }: { mood: OrbMood }): number {
  if (mood === "hearing") {
    return 0.8;
  }
  if (mood === "speaking") {
    return 1.2;
  }
  return 1;
}

/** Four decimals: below one step of an 8-bit channel, and short. */
function decimal({ value }: { value: number }): string {
  return value.toFixed(4);
}

/**
 * The colour matrix that turns a frame laid on black into its brightness times a gain, on all three channels.
 *
 * @returns the `values` of an `feColorMatrix` of type `matrix`
 */
export function rampMatrix({ gain }: { gain: number }): string {
  const row = [0.2126, 0.7152, 0.0722].map((weight) => decimal({ value: weight * gain })).join(" ");
  return `${row} 0 0 ${row} 0 0 ${row} 0 0 0 0 0 1 0`;
}

/** What the orb is drawn over: the dark disc or a dark page, or a light page. */
export type OrbGround = "dark" | "light";

/** Both grounds. */
export const ORB_GROUNDS = ["dark", "light"] as const satisfies readonly OrbGround[];

/**
 * Whether a value names a ground.
 *
 * @returns true for a name in {@link ORB_GROUNDS}
 */
export function isOrbGround(value: unknown): value is OrbGround {
  return ORB_GROUNDS.some((ground) => ground === value);
}

/**
 * What an orb is drawn over: the ground its nearest container names — the corner's dark disc, a preview tile's own
 * theme — else the page's own mode, which is what the full-screen stage's ground follows. A value naming no ground falls
 * through to the next, and with neither it is dark, the ground every ramp was picked on.
 *
 * @param ancestor the nearest `data-ground`, as read off the page
 * @param mode the page's `data-sw-mode`, as read off the page
 * @returns the ground
 */
export function orbGroundOf({
  ancestor,
  mode,
}: {
  ancestor: string | null | undefined;
  mode: string | null | undefined;
}): OrbGround {
  if (isOrbGround(ancestor)) {
    return ancestor;
  }
  if (isOrbGround(mode)) {
    return mode;
  }
  return "dark";
}

/**
 * One channel's transfer table.
 *
 * On a dark ground it is black, the dark colour, the light colour, white: the ramp the colours were picked on. On a
 * light ground the black and the white go. On Daylight's pale page the orb
 * otherwise reads as a colour clash, while the same orb on the corner's dark disc is fine. Every faint mark and
 * soft edge is a pixel low on the ramp, and its opacity is its brightness times {@link RAMP_OPACITY_GAIN}, so a
 * fringe a black → dark table paints a dark brown rim round each mark that only a black ground hides — and the white
 * core inside it reads as a head. So a light ground's table never leaves the theme's own two colours: faint light
 * takes the light one as a tint, and where it gathers it deepens to the dark one, colour on paper rather than light
 * on black.
 *
 * Between the two the table is eased stop by stop, so an orb that changes ground — the stage's orb landing off the
 * corner's fading disc onto a light page, or a theme worn in the Settings modal — crosses over rather than snapping.
 *
 * @param channel 0 red, 1 green, 2 blue
 * @param lightness how far toward the light ground's table, 0 (a dark ground) to 1 (a light one)
 * @returns the `tableValues` of that channel's `feFunc`
 */
export function rampTable({
  ramp,
  channel,
  lightness,
}: {
  ramp: RampChannels;
  channel: 0 | 1 | 2;
  lightness: number;
}): string {
  const dark = ramp.dark[channel];
  const light = ramp.light[channel];
  const share = Math.min(1, Math.max(0, lightness));
  if (share === 0) {
    // Exactly the table the colours were picked on.
    return `0 ${decimal({ value: dark })} ${decimal({ value: light })} 1`;
  }
  const onDark = [0, dark, light, 1];
  const onLight = [light, light, dark, dark];
  return onDark.map((stop, index) => decimal({ value: stop + (onLight[index] - stop) * share })).join(" ");
}

/**
 * Where {@link rampTable} settles over a ground.
 *
 * @returns 0 over a dark ground, 1 over a light one
 */
export function lightnessOf({ ground }: { ground: OrbGround }): number {
  switch (ground) {
    case "dark":
      return 0;
    case "light":
      return 1;
    default: {
      const unreachable: never = ground;
      return unreachable;
    }
  }
}

/** How close an eased lightness comes to its ground's before it is that ground's exactly. */
export const LIGHTNESS_SETTLED = 0.0001;

/**
 * A step of the way from one lightness toward a ground's, landing on it exactly once within
 * {@link LIGHTNESS_SETTLED}, so an orb back over a dark ground is drawn with the dark table itself rather than a
 * hair off it forever.
 *
 * @param from the lightness drawn last frame
 * @param ground what the orb is over now
 * @param share how far toward it this frame, 0 to 1
 * @returns the lightness to draw
 */
export function lightnessToward({ from, ground, share }: { from: number; ground: OrbGround; share: number }): number {
  const target = lightnessOf({ ground });
  const next = from + (target - from) * share;
  if (Math.abs(target - next) < LIGHTNESS_SETTLED) {
    return target;
  }
  return next;
}

/**
 * How steeply a pixel's brightness, before its ramp, becomes its opacity: black, the empty space between marks, is
 * clear, so the orb sits on whatever is under it and spills past its disc; anything a quarter bright or more is
 * solid, so on the dark disc it reads as it did on the black page it was picked on. Read off the brightness BEFORE the
 * ramp, so a gold theme and a lavender one fade at the same marks.
 */
export const RAMP_OPACITY_GAIN = 4;

/**
 * The colour matrix that turns the gained brightness (`rampMatrix`'s answer, grey, so its red channel is the
 * brightness) into an opacity mask: its alpha that brightness times {@link RAMP_OPACITY_GAIN}, held to 1 by the filter.
 *
 * @returns the `values` of an `feColorMatrix` of type `matrix`
 */
export function rampOpacityMatrix(): string {
  return `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${String(RAMP_OPACITY_GAIN)} 0 0 0 0`;
}

/**
 * A step of the way from one ramp to another.
 *
 * @param share how far, 0 to 1
 * @returns the ramp between
 */
export function rampToward({ from, to, share }: { from: RampChannels; to: RampChannels; share: number }): RampChannels {
  const mix = (a: readonly number[], b: readonly number[]): number[] =>
    a.map((value, index) => value + (b[index] - value) * share);
  return { dark: mix(from.dark, to.dark), light: mix(from.light, to.light) };
}
