/**
 * The four menu bar icons: the logo's mark, and what each state adds to it — nothing, a dimming, a solid badge, a
 * hollow ring badge — in the top-right corner. Synthetic marks stand in for the logo, so swapping the asset never
 * edits a test; the last case draws from the committed asset to prove the four still differ.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { type Glyph, glyphOf, LOGO_ASSET, readLogo } from "../../src/logo";
import { menuBarGlyph, RECOVERING_ALPHA, trayBitmap } from "../../src/trayIcon";

const SIZE = 32;

/** A 4x4 mark inked everywhere, so a badge's effect is the only thing that varies. */
const FULL: Glyph = { height: 4, ink: new Float32Array(16).fill(1), width: 4 };

/** A 2x2 mark inked on its top-left and bottom-right cells only. */
const DIAGONAL: Glyph = { height: 2, ink: Float32Array.from([1, 0, 0, 1]), width: 2 };

/** A 2x1 mark, wider than tall: one inked cell, one clear. */
const WIDE: Glyph = { height: 1, ink: Float32Array.from([1, 0]), width: 2 };

type Variant = "ready" | "recovering" | "attention" | "sharing";

/** The alpha of one pixel of a variant's 32px bitmap. */
function alpha({
  glyph,
  variant,
  column,
  row,
}: {
  glyph: Glyph;
  variant: Variant;
  column: number;
  row: number;
}): number {
  return trayBitmap({ glyph, size: SIZE, variant })[(row * SIZE + column) * 4 + 3]!;
}

describe("trayBitmap", () => {
  it("is size * size * 4 bytes with colour channels left black", () => {
    const pixels = trayBitmap({ glyph: DIAGONAL, size: 16, variant: "ready" });
    expect(pixels.length).toBe(1024);
    expect(pixels.filter((_, index) => index % 4 !== 3).every((byte) => byte === 0)).toBe(true);
  });

  it("scales the mark to fill the square", () => {
    const at = (column: number, row: number): number => alpha({ column, glyph: DIAGONAL, row, variant: "ready" });
    expect([at(4, 4), at(27, 4), at(4, 27), at(27, 27)]).toEqual([255, 0, 0, 255]);
  });

  it("centres a mark on its shorter side", () => {
    const at = (column: number, row: number): number => alpha({ column, glyph: WIDE, row, variant: "ready" });
    expect([at(4, 2), at(4, 16), at(4, 29), at(27, 16)]).toEqual([0, 255, 0, 0]);
  });

  it("dims the whole mark while recovering", () => {
    expect(alpha({ column: 16, glyph: FULL, row: 16, variant: "recovering" })).toBe(Math.round(255 * RECOVERING_ALPHA));
  });

  it("puts a solid badge in the top-right corner, cut clear of the mark, on attention", () => {
    const at = (column: number, row: number): number => alpha({ column, glyph: FULL, row, variant: "attention" });
    expect([at(27, 4), at(27, 11), at(4, 27)]).toEqual([255, 0, 255]);
  });

  it("puts a hollow ring badge there while sharing", () => {
    const at = (column: number, row: number): number => alpha({ column, glyph: FULL, row, variant: "sharing" });
    expect([at(27, 4), at(27, 0), at(27, 11)]).toEqual([0, 255, 0]);
  });

  it("draws an empty mark as nothing", () => {
    const empty: Glyph = { height: 0, ink: new Float32Array(0), width: 0 };
    expect(trayBitmap({ glyph: empty, size: 16, variant: "ready" }).every((byte) => byte === 0)).toBe(true);
  });

  it("draws four different icons from the committed logo", () => {
    const glyph = glyphOf({ logo: unwrap(readLogo({ bytes: readFileSync(join(__dirname, "..", "..", LOGO_ASSET)) })) });
    const variants = ["ready", "recovering", "attention", "sharing"] as const;
    const encoded = variants.map((variant) =>
      Buffer.from(trayBitmap({ glyph, size: SIZE, variant })).toString("base64"),
    );
    expect(new Set(encoded).size).toBe(4);
  });
});

describe("menuBarGlyph", () => {
  it("hands back the committed logo's mark unchanged", () => {
    const logo = unwrap(readLogo({ bytes: readFileSync(join(__dirname, "..", "..", LOGO_ASSET)) }));
    expect(unwrap(menuBarGlyph({ logo }))).toEqual(glyphOf({ logo }));
  });

  it("names a mark of two far-apart specks, which averages away to blank at 16px", () => {
    const side = 1024;
    const pixels = new Uint8Array(side * side * 4);
    pixels[3] = 255;
    pixels[(side * side - 1) * 4 + 3] = 255;
    expect(unwrapErr(menuBarGlyph({ logo: { pixels, side } })).code).toBe("LOGO_TOO_FAINT");
  });
});
