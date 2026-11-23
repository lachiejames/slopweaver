/**
 * Region-scoped blankness over synthetic pixel fixtures — including the incident's own shape, where every
 * WHOLE row carries ink (a sidebar) and the panel's own column range is empty.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { packRgba } from "../../../proof/yarnWhy/pixels.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { measureRegionInk, type PixelSource } from "../../../visualEvidence/pixels.js";

const WHITE = packRgba({ a: 255, b: 255, g: 255, r: 255 });
const INK = packRgba({ a: 255, b: 40, g: 40, r: 40 });
const GREY = packRgba({ a: 255, b: 235, g: 235, r: 235 });

/** A white image with ink wherever `inked` says so. */
function image({
  width,
  height,
  inked,
}: {
  width: number;
  height: number;
  inked: (point: { x: number; y: number }) => boolean;
}): PixelSource {
  return {
    // named-object-params-exempt: matches Jimp's own real getPixelColor(x, y) call shape, which this repo does not own
    getPixelColor(x: number, y: number): number {
      return inked({ x, y }) ? INK : WHITE;
    },
    height,
    width,
  };
}

describe("measureRegionInk", () => {
  it("finds an empty panel beside a full sidebar — the incident's shape — when scanning the panel alone", () => {
    // A 200-wide image: columns 5..39 are a sidebar with ink on every row; the panel is 60..199 and blank.
    const incident = image({ height: 100, inked: ({ x }) => x >= 5 && x < 40, width: 200 });
    const panel = unwrap(
      measureRegionInk({ image: incident, region: { height: 100, width: 140, x: 60, y: 0 }, sampleStride: 1 }),
    );
    expect(panel.inkRows).toBe(0);
    expect(panel.inkRowFraction).toBe(0);
    expect(panel.bands).toEqual([{ fromY: 0, rows: 100, toY: 99 }]);
    expect(panel.longestBlankRows).toBe(100);
    const wholeRow = unwrap(
      measureRegionInk({ image: incident, region: { height: 100, width: 200, x: 0, y: 0 }, sampleStride: 1 }),
    );
    expect(wholeRow.inkRowFraction).toBe(1);
  });

  it("reports bands exactly, with the ink rows between them", () => {
    // Ink on rows 10..19 and 50..54 within a 60-tall region; blank 0..9, 20..49, 55..59.
    const banded = image({ height: 60, inked: ({ y }) => (y >= 10 && y < 20) || (y >= 50 && y < 55), width: 30 });
    const measured = unwrap(
      measureRegionInk({ image: banded, region: { height: 60, width: 30, x: 0, y: 0 }, sampleStride: 1 }),
    );
    expect(measured.inkRows).toBe(15);
    expect(measured.rows).toBe(60);
    expect(measured.inkRowFraction).toBe(0.25);
    expect(measured.bands).toEqual([
      { fromY: 0, rows: 10, toY: 9 },
      { fromY: 20, rows: 30, toY: 49 },
      { fromY: 55, rows: 5, toY: 59 },
    ]);
    expect(measured.longestBlankRows).toBe(30);
  });

  it("scans only the region: ink outside it does not count", () => {
    const outside = image({ height: 50, inked: ({ x, y }) => x < 10 || y < 5, width: 50 });
    const measured = unwrap(
      measureRegionInk({ image: outside, region: { height: 40, width: 30, x: 15, y: 8 }, sampleStride: 1 }),
    );
    expect(measured.inkRows).toBe(0);
    expect(measured.rows).toBe(40);
  });

  it("samples columns at the stride, so a one-column line between samples is missed and the stride says so", () => {
    const hairline = image({ height: 10, inked: ({ x }) => x === 3, width: 32 });
    expect(
      unwrap(measureRegionInk({ image: hairline, region: { height: 10, width: 32, x: 0, y: 0 }, sampleStride: 8 }))
        .inkRows,
    ).toBe(0);
    expect(
      unwrap(measureRegionInk({ image: hairline, region: { height: 10, width: 32, x: 0, y: 0 }, sampleStride: 1 }))
        .inkRows,
    ).toBe(10);
  });

  it("treats a faint difference inside the tolerance as background", () => {
    const faint: PixelSource = {
      // named-object-params-exempt: matches Jimp's own real getPixelColor(x, y) call shape, which this repo does not own
      getPixelColor(x: number, _y: number): number {
        return x === 5 ? GREY : WHITE;
      },
      height: 4,
      width: 10,
    };
    expect(
      unwrap(
        measureRegionInk({
          image: faint,
          region: { height: 4, width: 10, x: 0, y: 0 },
          sampleStride: 1,
          tolerance: 60,
        }),
      ).inkRows,
    ).toBe(0);
    expect(
      unwrap(
        measureRegionInk({
          image: faint,
          region: { height: 4, width: 10, x: 0, y: 0 },
          sampleStride: 1,
          tolerance: 18,
        }),
      ).inkRows,
    ).toBe(4);
  });

  it("refuses when the region's corners do not agree on a background", () => {
    const corners = image({ height: 20, inked: ({ x, y }) => x === 0 && y === 0, width: 20 });
    // Only one corner differs, so three still agree — accepted.
    expect(unwrap(measureRegionInk({ image: corners, region: { height: 20, width: 20, x: 0, y: 0 } })).background).toBe(
      WHITE,
    );
    const split = image({ height: 20, inked: ({ x }) => x < 10, width: 20 });
    expect(
      visualEvidenceErrorLines({
        error: unwrapErr(measureRegionInk({ image: split, region: { height: 20, width: 20, x: 0, y: 0 } })),
      }),
    ).toEqual(["the region's four corners do not agree on a background colour, so blankness cannot be judged"]);
  });

  it("refuses a region off the image or too small to measure", () => {
    const small = image({ height: 10, inked: () => false, width: 10 });
    expect(
      visualEvidenceErrorLines({
        error: unwrapErr(measureRegionInk({ image: small, region: { height: 5, width: 5, x: 8, y: 0 } })),
      }),
    ).toEqual(["the region 8,0 5x5 lies outside the 10x10 image"]);
    expect(
      visualEvidenceErrorLines({
        error: unwrapErr(measureRegionInk({ image: small, region: { height: 1, width: 5, x: 0, y: 0 } })),
      }),
    ).toEqual(["a 5x1 region is too small to measure"]);
  });
});
