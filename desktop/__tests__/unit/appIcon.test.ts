/**
 * The app icon: the logo full bleed at every size, packed into a well-formed `.icns` carrying every size macOS
 * draws an app icon at. A synthetic logo stands in for the asset, so swapping the asset never edits a test.
 */
import { describe, expect, it } from "vitest";

import { appIconBitmap, appIconIcns, encodePng, ICNS_SIZES } from "../../src/appIcon";
import type { Bitmap } from "../../src/logo";

/** A 1024px logo: the left half opaque red, the right half opaque blue. */
function halves(): Bitmap {
  const side = 1024;
  const pixels = new Uint8Array(side * side * 4);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      pixels.set(column < side / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], (row * side + column) * 4);
    }
  }
  return { pixels, side };
}

const LOGO = halves();

describe("appIconBitmap", () => {
  it("draws the logo full bleed, opaque to the corners", () => {
    expect([...appIconBitmap({ logo: LOGO, size: 2 })]).toEqual([
      255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255,
    ]);
  });
});

describe("encodePng", () => {
  it("starts with the PNG signature and ends with IEND", () => {
    const png = encodePng({ pixels: appIconBitmap({ logo: LOGO, size: 16 }), size: 16 });
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
  });
});

describe("appIconIcns", () => {
  const icns = appIconIcns({ logo: LOGO });

  it("opens with the icns magic and its own length", () => {
    expect(icns.subarray(0, 4).toString("ascii")).toBe("icns");
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });

  it("carries one PNG entry per declared size, in order, each the side it declares", () => {
    const entries: Array<{ type: string; side: number }> = [];
    for (let offset = 8; offset < icns.length; offset += icns.readUInt32BE(offset + 4)) {
      // The entry's 8-byte head, then the PNG: its IHDR width sits 16 bytes in.
      entries.push({ side: icns.readUInt32BE(offset + 24), type: icns.subarray(offset, offset + 4).toString("ascii") });
    }
    expect(entries).toEqual(ICNS_SIZES.map(({ type, size }) => ({ side: size, type })));
  });

  it("covers every side from 16 to 1024", () => {
    expect([...new Set(ICNS_SIZES.map(({ size }) => size))]).toEqual([16, 32, 64, 128, 256, 512, 1024]);
  });
});
