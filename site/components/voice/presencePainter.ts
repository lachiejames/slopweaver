/**
 * What every presence painter shares: the frame it is handed, and the few grey drawing helpers that keep every
 * presence edgeless.
 *
 * A painter draws grey light only, additively, and never picks a hue: the canvas's one SVG filter colours whatever it
 * draws through the theme's ramp (`site/lib/orbRamp.ts`), so a brighter grey climbs the ramp toward its light colour
 * and white. Who is talking shows as direction, density, speed and spread. There is no `ctx.filter` blur anywhere —
 * it is slow and would stack under the ramp's filter — so softness is a radial gradient falling to nothing, drawn in
 * two passes where one would look hard.
 *
 * A painter is made by a factory (`presencePainters.ts`), whose closure owns whatever the presence carries between
 * frames, so a change of presence drops the old one's state whole.
 */
import type { OrbMood } from "../../lib/orbMood";
import type { PresenceVoiceInput } from "../../lib/presenceInput";
import type { SwarmDetail } from "../../lib/swarmDetail";

/** What a painter is handed each frame. */
export interface PresencePaintFrame {
  readonly ctx: CanvasRenderingContext2D;
  /** The canvas's size in CSS pixels, bleed included; the context is already scaled for the display and cleared. */
  readonly w: number;
  readonly h: number;
  /** The orb's own square, in CSS pixels, centred on the canvas: the canvas reaches past it on every side. */
  readonly box: number;
  /** The page's clock, in seconds, for anything timed against the wall rather than the presence's pace. */
  readonly nowS: number;
  /** The presence's clock, in seconds, run at the mood's pace and stopped under reduce-motion. */
  readonly clockS: number;
  /** Since the last frame, capped so a window back from the background never leaps. */
  readonly dtS: number;
  /** False under reduce-motion: nothing spawns, ages or travels, and only the level's brightness and size move. */
  readonly moving: boolean;
  /** Refined on the stage and the full-screen previews, plain in the corner (`site/lib/swarmDetail.ts`). */
  readonly detail: SwarmDetail;
  readonly mood: OrbMood;
  /** The level that lights the orb (`--lvl`), 0 to 1, already eased at the ElevenLabs follower's pace. */
  readonly level: number;
  /** The level that moves it (`--move-lvl`), 0 to 1, eased the same way: the corner's is calmer. */
  readonly moveLevel: number;
  /** The mood's pace, as a multiple of the resting pace: below 1 is quicker. */
  readonly pace: number;
  /** Whether a `?voice=sim` preview is playing a made-up voice. */
  readonly sim: boolean;
  readonly voice: PresenceVoiceInput;
}

/** A painter: draws one frame of one presence. */
export type PresencePainter = (frame: PresencePaintFrame) => void;

/** A painter's maker: a fresh closure, carrying nothing from any presence drawn before it. */
export type PresencePainterFactory = () => PresencePainter;

/** The grey a presence draws at rest, mid-ramp. */
export const REST_GREY = 0.5;

/** The grey the owner's voice is drawn in: a little darker, so where they speak the orb leans to the ramp's dark colour. */
export const OWNER_GREY = 0.44;

/** The grey the voice's own is drawn in: a little brighter, so where it speaks the orb climbs toward white. */
export const BOT_GREY = 0.6;

/**
 * The grey for whoever is talking.
 *
 * @returns 0 to 1
 */
export function greyOf({ voice }: { voice: PresenceVoiceInput }): number {
  if (voice.turn === "owner") {
    return OWNER_GREY;
  }
  if (voice.turn === "bot") {
    return BOT_GREY;
  }
  return REST_GREY;
}

/**
 * Which way the voice moves a presence: in toward the middle while the owner speaks, out from it while the voice does, the
 * swarm's own drift (`flowOf`, `site/lib/particleMotion.ts`).
 *
 * @returns −1 the owner, 1 the voice, 0 nobody
 */
export function flowSignOf({ voice }: { voice: PresenceVoiceInput }): number {
  if (voice.turn === "owner") {
    return -1;
  }
  if (voice.turn === "bot") {
    return 1;
  }
  return 0;
}

/**
 * How brightly a presence is lit by the level: never dark at rest, a little brighter as the voice rises — the swarm's
 * own lift.
 *
 * @param level the level that lights the orb, 0 to 1
 * @returns a multiplier on every alpha, 0.85 to 1
 */
export function presenceLightOf({ level }: { level: number }): number {
  return 0.85 + 0.15 * level;
}

/**
 * A grey as a CSS colour at an alpha.
 *
 * @param grey its lightness, 0 to 1
 * @param alpha its alpha, held to 0 to 1
 * @returns the `rgb(… / …)` string
 */
export function greyCss({ grey, alpha }: { grey: number; alpha: number }): string {
  const percent = Math.round(Math.min(1, Math.max(0, grey)) * 100);
  const a = Math.min(1, Math.max(0, alpha));
  return `rgb(${String(percent)}% ${String(percent)}% ${String(percent)}% / ${a.toFixed(3)})`;
}

/**
 * A seeded random stream, so a reload draws the same field.
 *
 * @returns a function answering the next number in 0–1
 */
export function seeded({ seed }: { seed: number }): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Smooth wandering noise from a few incommensurate sines.
 *
 * @param x where along the noise, usually a clock
 * @param seed which wander, so two never move together
 * @returns a value in −1 to 1
 */
export function wander({ x, seed }: { x: number; seed: number }): number {
  return (Math.sin(x * 1.3 + seed) + Math.sin(x * 2.1 + seed * 1.7) * 0.6 + Math.sin(x * 0.7 + seed * 2.3) * 0.8) / 2.4;
}

/**
 * A soft round of grey light: a radial gradient from the grey to nothing, so there is never an edge, then a wider,
 * fainter one under it where a blur would have spread it.
 *
 * @param r its radius, CSS pixels; nothing is drawn at 0
 * @param alpha its centre's alpha
 */
export function greySpot({
  ctx,
  x,
  y,
  r,
  grey,
  alpha,
}: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  r: number;
  grey: number;
  alpha: number;
}): void {
  if (r <= 0 || alpha <= 0) {
    return;
  }
  for (const [reach, share] of [
    [1.45, 0.35],
    [1, 1],
  ] as const) {
    const radius = r * reach;
    const a = alpha * share;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, greyCss({ alpha: a, grey }));
    g.addColorStop(0.45, greyCss({ alpha: a * 0.5, grey }));
    g.addColorStop(1, greyCss({ alpha: 0, grey }));
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}
