/**
 * The four menu bar icons, each the Slopweaver logo's mark (the menu bar icon is the logo) read from the same asset as the app icon (`logo.ts`), so swapping it is replacing that
 * one file. Each is a macOS TEMPLATE image — black with an alpha channel — which the menu bar recolours for a
 * light or dark bar itself. The states stay told apart by what is added to the mark, in the corner the logo
 * leaves empty. Pure.
 *
 * - ready: the mark alone.
 * - recovering: the mark dimmed — the shell is bringing the console back by itself, so it asks nothing.
 * - attention: a solid badge in the top-right corner — recovery failed and it is the owner's to act on.
 * - sharing: a hollow ring badge in that corner — the owner's screen is going to the voice.
 */
import { err, ok, type Result } from "neverthrow";

import { type LogoError, LogoErrors } from "./errors";
import { type Bitmap, type Glyph, glyphOf } from "./logo";
import type { IconVariant } from "./shellState";

/** Samples per pixel side for the badges, so their edges are antialiased rather than stair-stepped. */
const SUPERSAMPLE = 4;

/** How strongly the dimmed mark is drawn while the console recovers, 0-1. */
export const RECOVERING_ALPHA = 0.45;

/** The badge's centre in the unit square: the top-right corner, which the logo's mark leaves empty. */
const BADGE_X = 0.86;
const BADGE_Y = 0.14;

/** The attention badge's radius, the sharing ring's inner and outer radii, and the clear gap cut round either. */
const DOT_RADIUS = 0.15;
const RING_INNER = 0.08;
const RING_OUTER = 0.16;
const GAP_RADIUS = 0.24;

/** The share of a glyph's ink inside one rectangle of glyph pixels, 0-1; empty or out of range is 0. */
function inkIn({
  glyph,
  left,
  top,
  right,
  bottom,
}: {
  glyph: Glyph;
  left: number;
  top: number;
  right: number;
  bottom: number;
}): number {
  if (right <= 0 || bottom <= 0 || left >= glyph.width || top >= glyph.height) {
    return 0;
  }
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(glyph.width, Math.max(x0 + 1, Math.ceil(right)));
  const y1 = Math.min(glyph.height, Math.max(y0 + 1, Math.ceil(bottom)));
  if (x1 <= x0 || y1 <= y0) {
    return 0;
  }
  let total = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      total += glyph.ink[y * glyph.width + x]!;
    }
  }
  const covered = Math.max(1, Math.round((right - left) * (bottom - top)));
  return Math.min(1, total / covered);
}

/** What a variant adds at one point of the unit square: the badge it inks, and the gap it clears round it. */
function badgeAt({ variant, x, y }: { variant: IconVariant; x: number; y: number }): { ink: boolean; clear: boolean } {
  const r = Math.hypot(x - BADGE_X, y - BADGE_Y);
  switch (variant) {
    case "ready":
    case "recovering":
      return { clear: false, ink: false };
    case "attention":
      return { clear: r <= GAP_RADIUS, ink: r <= DOT_RADIUS };
    case "sharing":
      return { clear: r <= GAP_RADIUS, ink: r >= RING_INNER && r <= RING_OUTER };
    default: {
      const unhandled: never = variant;
      return unhandled;
    }
  }
}

/**
 * One icon as a square of 32-bit pixels, four bytes each with alpha last — the layout Electron's
 * `nativeImage.createFromBitmap` takes on macOS. Colour is black, so only alpha carries the shape. The mark is
 * scaled to fill the square on its longer side and centred on the shorter.
 *
 * @param glyph the logo's mark, from `glyphOf`
 * @param variant which icon
 * @param size the side in pixels: 16 for a 1x menu bar, 32 for a Retina one
 * @returns `size * size * 4` bytes
 */
export function trayBitmap({ glyph, variant, size }: { glyph: Glyph; variant: IconVariant; size: number }): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const longer = Math.max(glyph.width, glyph.height);
  const perPixel = longer / size;
  const offsetX = (longer - glyph.width) / 2;
  const offsetY = (longer - glyph.height) / 2;
  const strength = variant === "recovering" ? RECOVERING_ALPHA : 1;
  const samples = SUPERSAMPLE * SUPERSAMPLE;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      let inked = 0;
      let cleared = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy += 1) {
        for (let sx = 0; sx < SUPERSAMPLE; sx += 1) {
          const badge = badgeAt({
            variant,
            x: (column + (sx + 0.5) / SUPERSAMPLE) / size,
            y: (row + (sy + 0.5) / SUPERSAMPLE) / size,
          });
          inked += badge.ink ? 1 : 0;
          cleared += badge.clear ? 1 : 0;
        }
      }
      const mark =
        longer === 0
          ? 0
          : inkIn({
              bottom: (row + 1) * perPixel - offsetY,
              glyph,
              left: column * perPixel - offsetX,
              right: (column + 1) * perPixel - offsetX,
              top: row * perPixel - offsetY,
            });
      const alpha = Math.min(1, mark * strength * (1 - cleared / samples) + inked / samples);
      pixels[(row * size + column) * 4 + 3] = Math.round(255 * alpha);
    }
  }
  return pixels;
}

/** The menu bar's 1x side, the smallest the mark is ever drawn. */
const SMALLEST_SIDE = 16;

/** The alpha the ready icon's strongest pixel must reach at that side, so the mark is not lost to averaging. */
const MIN_VISIBLE_ALPHA = 128;

/**
 * The logo's mark for the menu bar, refused when drawing it at its smallest size leaves nothing visible — a mark
 * of isolated specks spread across the asset passes every per-pixel check and still averages away to blank.
 *
 * @param logo the decoded asset, from `readLogo`
 * @returns the mark, or LOGO_TOO_FAINT
 */
export function menuBarGlyph({ logo }: { logo: Bitmap }): Result<Glyph, LogoError> {
  const glyph = glyphOf({ logo });
  const drawn = trayBitmap({ glyph, size: SMALLEST_SIDE, variant: "ready" });
  let strongest = 0;
  for (let at = 3; at < drawn.length; at += 4) {
    strongest = Math.max(strongest, drawn[at]!);
  }
  if (strongest < MIN_VISIBLE_ALPHA) {
    return err(LogoErrors.tooFaint({ size: SMALLEST_SIDE }));
  }
  return ok(glyph);
}

/**
 * Whether the pixel at a position is fully inked — what a test reads to tell the shapes apart.
 *
 * @param pixels a bitmap from {@link trayBitmap}
 * @param size its side
 * @param column the pixel's column
 * @param row the pixel's row
 * @returns true when that pixel's alpha is 255
 */
export function isSolid({
  pixels,
  size,
  column,
  row,
}: {
  pixels: Uint8Array;
  size: number;
  column: number;
  row: number;
}): boolean {
  return pixels[(row * size + column) * 4 + 3] === 255;
}
