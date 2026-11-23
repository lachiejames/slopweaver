/*
 * The contrast arithmetic the palette tests stand on, pinned to known colours so a wrong matrix entry cannot
 * pass every palette by accident.
 */

import { describe, expect, it } from "vitest";

import {
  compositeSrgb,
  contrastRatio,
  oklchToSrgb,
  oklchToSrgbOnDisplayP3,
  parseHex,
  parseOklch,
  relativeLuminance,
  srgbContrastRatio,
  srgbToOklch,
} from "../../lib/colorContrast";

const WHITE = parseOklch({ value: "oklch(1 0 0)" });
const BLACK = parseOklch({ value: "oklch(0 0 0)" });

describe("parseOklch", () => {
  it("reads the three components of a palette token", () => {
    expect(parseOklch({ value: "oklch(0.72 0.14 185)" })).toEqual({ chroma: 0.14, hue: 185, lightness: 0.72 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseOklch({ value: "  oklch( 0.5 0 90 ) " })).toEqual({ chroma: 0, hue: 90, lightness: 0.5 });
  });

  it("refuses anything else, naming it", () => {
    expect(() => parseOklch({ value: "#ffffff" })).toThrow("not an oklch(L C H) colour: #ffffff");
    expect(() => parseOklch({ value: "oklch(0.5 0.1)" })).toThrow("not an oklch(L C H) colour: oklch(0.5 0.1)");
  });
});

describe("srgbToOklch", () => {
  it("maps pure sRGB red to CSS Color 4's oklch for it", () => {
    const red = srgbToOklch({ color: { blue: 0, green: 0, red: 1 } });
    expect(red.lightness).toBeCloseTo(0.62796, 4);
    expect(red.chroma).toBeCloseTo(0.25768, 4);
    expect(red.hue).toBeCloseTo(29.2339, 2);
  });

  it("round-trips a brand colour through oklchToSrgb", () => {
    const hex = parseHex({ value: "#5E6AD2" });
    const back = oklchToSrgb({ color: srgbToOklch({ color: hex }) });
    expect(back.red).toBeCloseTo(hex.red, 6);
    expect(back.green).toBeCloseTo(hex.green, 6);
    expect(back.blue).toBeCloseTo(hex.blue, 6);
  });
});

describe("parseHex", () => {
  it("reads #rrggbb in either case", () => {
    expect(parseHex({ value: "#FF0080" })).toEqual({ blue: 128 / 255, green: 0, red: 1 });
    expect(parseHex({ value: "#ff0080" })).toEqual({ blue: 128 / 255, green: 0, red: 1 });
  });

  it("refuses anything else, naming it", () => {
    expect(() => parseHex({ value: "#fff" })).toThrow("not a #rrggbb colour: #fff");
  });
});

describe("oklchToSrgb", () => {
  it("maps white and black to the sRGB extremes", () => {
    const white = oklchToSrgb({ color: WHITE });
    expect(white.red).toBeCloseTo(1, 3);
    expect(white.green).toBeCloseTo(1, 3);
    expect(white.blue).toBeCloseTo(1, 3);
    expect(oklchToSrgb({ color: BLACK })).toEqual({ blue: 0, green: 0, red: 0 });
  });

  it("maps CSS Color 4's oklch for pure sRGB red back to red", () => {
    const red = oklchToSrgb({ color: parseOklch({ value: "oklch(0.62796 0.25768 29.2339)" }) });
    expect(red.red).toBeCloseTo(1, 2);
    expect(red.green).toBeCloseTo(0, 2);
    expect(red.blue).toBeCloseTo(0, 2);
  });

  it("maps CSS Color 4's oklch for pure sRGB blue back to blue", () => {
    const blue = oklchToSrgb({ color: parseOklch({ value: "oklch(0.45201 0.31321 264.052)" }) });
    expect(blue.red).toBeCloseTo(0, 2);
    expect(blue.green).toBeCloseTo(0, 2);
    expect(blue.blue).toBeCloseTo(1, 2);
  });

  it("clamps an out-of-gamut colour into [0, 1] rather than returning a negative channel", () => {
    const wild = oklchToSrgb({ color: parseOklch({ value: "oklch(0.9 0.4 150)" }) });
    expect(Math.min(wild.red, wild.green, wild.blue)).toBeGreaterThanOrEqual(0);
    expect(Math.max(wild.red, wild.green, wild.blue)).toBeLessThanOrEqual(1);
  });

  it("puts a neutral mid-grey on equal channels", () => {
    const grey = oklchToSrgb({ color: parseOklch({ value: "oklch(0.6 0 0)" }) });
    expect(grey.red).toBeCloseTo(grey.green, 6);
    expect(grey.green).toBeCloseTo(grey.blue, 6);
  });
});

describe("oklchToSrgbOnDisplayP3", () => {
  it("draws a colour inside sRGB exactly as oklchToSrgb does", () => {
    const teal = parseOklch({ value: "oklch(0.6 0.08 185)" });
    const onP3 = oklchToSrgbOnDisplayP3({ color: teal });
    const onSrgb = oklchToSrgb({ color: teal });
    expect(onP3.red).toBeCloseTo(onSrgb.red, 5);
    expect(onP3.green).toBeCloseTo(onSrgb.green, 5);
    expect(onP3.blue).toBeCloseTo(onSrgb.blue, 5);
  });

  it("keeps a colour past sRGB but inside P3 unclipped, a channel below zero and its true luminance", () => {
    const danger = parseOklch({ value: "oklch(0.86 0.09 25)" });
    const onP3 = oklchToSrgbOnDisplayP3({ color: danger });
    expect(onP3.blue).toBeLessThan(1);
    expect(onP3.red).toBeGreaterThan(1);
    expect(Number(relativeLuminance({ color: onP3 }).toFixed(4))).toBe(0.6137);
    expect(Number(relativeLuminance({ color: oklchToSrgb({ color: danger }) }).toFixed(4))).toBe(0.5982);
  });

  it("clips a colour past P3 to P3's edge rather than drawing it unclipped", () => {
    const wild = oklchToSrgbOnDisplayP3({ color: parseOklch({ value: "oklch(0.9 0.4 150)" }) });
    expect(Number(relativeLuminance({ color: wild }).toFixed(4))).toBeLessThan(1.05);
    expect(wild.green).toBeGreaterThan(1);
  });
});

describe("relativeLuminance and contrastRatio", () => {
  it("gives white 1 and black 0", () => {
    expect(relativeLuminance({ color: { blue: 1, green: 1, red: 1 } })).toBeCloseTo(1, 6);
    expect(relativeLuminance({ color: { blue: 0, green: 0, red: 0 } })).toBe(0);
  });

  it("measures black on white at 21:1 either way round", () => {
    expect(contrastRatio({ background: WHITE, foreground: BLACK })).toBeCloseTo(21, 2);
    expect(contrastRatio({ background: BLACK, foreground: WHITE })).toBeCloseTo(21, 2);
  });

  it("measures a colour on itself at 1:1", () => {
    const teal = parseOklch({ value: "oklch(0.72 0.14 185)" });
    expect(contrastRatio({ background: teal, foreground: teal })).toBe(1);
  });

  it("measures sRGB mid-grey 0x77 on white at the textbook 4.48:1", () => {
    const grey = 0x77 / 255;
    expect(
      srgbContrastRatio({
        background: { blue: 1, green: 1, red: 1 },
        foreground: { blue: grey, green: grey, red: grey },
      }),
    ).toBeCloseTo(4.48, 2);
  });
});

describe("compositeSrgb", () => {
  const ink = { blue: 1, green: 0.5, red: 0 };
  const ground = { blue: 0, green: 0, red: 1 };

  it("shows only the ground at alpha 0", () => {
    expect(compositeSrgb({ alpha: 0, background: ground, foreground: ink })).toEqual(ground);
  });

  it("shows only the fill at alpha 1", () => {
    expect(compositeSrgb({ alpha: 1, background: ground, foreground: ink })).toEqual(ink);
  });

  it("averages the two at alpha 0.5", () => {
    expect(compositeSrgb({ alpha: 0.5, background: ground, foreground: ink })).toEqual({
      blue: 0.5,
      green: 0.25,
      red: 0.5,
    });
  });
});
