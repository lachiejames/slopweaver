import { describe, expect, it } from "vitest";

import {
  findLastContentRow,
  type PixelSource,
  packRgba,
  rgbDistance,
  unpackRgba,
} from "../../../../proof/yarnWhy/pixels.js";

describe("packRgba / unpackRgba", () => {
  it("round-trips channels through the packed 0xRRGGBBAA form", () => {
    const packed = packRgba({ a: 255, b: 40, g: 130, r: 20 });

    expect(unpackRgba({ color: packed })).toEqual({ a: 255, b: 40, g: 130, r: 20 });
  });
});

describe("rgbDistance", () => {
  it("is zero for identical colors", () => {
    const color = packRgba({ a: 255, b: 30, g: 30, r: 30 });

    expect(rgbDistance({ a: color, b: color })).toBe(0);
  });

  it("sums the RGB channel differences, ignoring alpha", () => {
    const a = packRgba({ a: 255, b: 10, g: 10, r: 10 });
    const b = packRgba({ a: 0, b: 20, g: 15, r: 10 });

    expect(rgbDistance({ a, b })).toBe(0 + 5 + 10);
  });
});

/** A plain in-memory pixel grid — no image library, so this stays a pure-logic test per `testing.md`. */
function gridOf({ width, height, rows }: { width: number; height: number; rows: Record<number, number> }): PixelSource {
  const background = packRgba({ a: 255, b: 30, g: 32, r: 20 });
  const content = packRgba({ a: 255, b: 200, g: 220, r: 230 });
  return {
    getPixelColor: (_x, y) => (rows[y] === 1 ? content : background),
    height,
    width,
  };
}

describe("findLastContentRow", () => {
  it("finds the last row with content above a run of trailing blank rows", () => {
    const image = gridOf({ height: 10, rows: { 3: 1, 6: 1 }, width: 20 });

    expect(findLastContentRow({ image })).toBe(6);
  });

  it("returns 0 when the whole image is background", () => {
    const image = gridOf({ height: 10, rows: {}, width: 20 });

    expect(findLastContentRow({ image })).toBe(0);
  });

  it("returns the last row when content reaches the bottom (no trailing blank to trim)", () => {
    const image = gridOf({ height: 10, rows: { 9: 1 }, width: 20 });

    expect(findLastContentRow({ image })).toBe(9);
  });
});
