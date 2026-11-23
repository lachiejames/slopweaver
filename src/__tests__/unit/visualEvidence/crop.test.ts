/**
 * Crop geometry over the numbers a live capture reported: a 2016x883 viewport painted
 * at 1.5 into a 4032x1766 image (the owner's Chrome at 75% zoom, canvas sized at the display's own 2x).
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import {
  captureScale,
  DEFAULT_CROP_PADDING_CSS_PX,
  decideEvidenceCrop,
  rectContains,
  relativeTo,
  toImageRect,
} from "../../../visualEvidence/crop.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";

const LIVE = { devicePixelRatio: 1.5, frameHeight: 883, frameWidth: 2016, imageHeight: 1766, imageWidth: 4032 };

const REGIONS = [
  { name: "chart", rect: { height: 442, width: 1504, x: 472, y: 441 } },
  { name: "summary", rect: { height: 18, width: 242, x: 510, y: 372 } },
  { name: "query", rect: { height: 112, width: 1824, x: 176, y: 88 } },
  { name: "time range", rect: { height: 28, width: 376, x: 1462, y: 89 } },
];

describe("captureScale", () => {
  it("is the page's devicePixelRatio when the image is at least the painted frame", () => {
    expect(unwrap(captureScale({ geometry: LIVE }))).toBe(1.5);
  });

  it("is 2 for an unzoomed page whose image is exactly twice the frame", () => {
    expect(unwrap(captureScale({ geometry: { ...LIVE, devicePixelRatio: 2 } }))).toBe(2);
  });

  it("refuses an image smaller than the frame painted at that ratio, naming both sizes", () => {
    const problems = visualEvidenceErrorLines({
      error: unwrapErr(captureScale({ geometry: { ...LIVE, devicePixelRatio: 2.5 } })),
    });
    expect(problems).toEqual([
      "a 2016x883 frame painted at 2.5 needs at least 5040x2207 image pixels; the capture is 4032x1766",
    ]);
  });

  it("refuses a non-positive ratio and a non-positive dimension", () => {
    expect(
      visualEvidenceErrorLines({ error: unwrapErr(captureScale({ geometry: { ...LIVE, devicePixelRatio: 0 } })) }),
    ).toEqual(["the page reported a devicePixelRatio of 0, which is not a paint scale"]);
    expect(
      visualEvidenceErrorLines({ error: unwrapErr(captureScale({ geometry: { ...LIVE, frameWidth: 0 } })) }),
    ).toEqual(["the capture's geometry has a non-positive dimension, so no scale can be measured"]);
  });
});

describe("decideEvidenceCrop", () => {
  it("takes the padded union of every region at the paint scale — the live capture's own crop", () => {
    const crop = unwrap(decideEvidenceCrop({ geometry: LIVE, regions: REGIONS }));
    expect(crop.scale).toBe(1.5);
    expect(crop.unionCss).toEqual({ height: 795, width: 1824, x: 176, y: 88 });
    // The union's x less the padding, scaled by 1.5 (x 246, y 114), and its far edge plus the padding, scaled (3018, 1342.5 -> 1343).
    expect(crop.rect).toEqual({ height: 1229, width: 2772, x: 246, y: 114 });
  });

  it("rounds outward on fractional edges", () => {
    const crop = unwrap(
      decideEvidenceCrop({
        geometry: LIVE,
        paddingCssPx: 0,
        regions: [{ name: "edge", rect: { height: 10.5, width: 2000.2, x: 10.3, y: 872.5 } }],
      }),
    );
    // 10.3*1.5 = 15.45 -> 15; (10.3+2000.2)*1.5 = 3015.75 -> 3016; 872.5*1.5 = 1308.75 -> 1308; 883*1.5 -> 1325
    expect(crop.rect).toEqual({ height: 17, width: 3001, x: 15, y: 1308 });
  });

  it("refuses an empty region list, a region with no area, and one off the frame, by name", () => {
    expect(visualEvidenceErrorLines({ error: unwrapErr(decideEvidenceCrop({ geometry: LIVE, regions: [] })) })).toEqual(
      ["a crop needs at least one required region"],
    );
    const problems = visualEvidenceErrorLines({
      error: unwrapErr(
        decideEvidenceCrop({
          geometry: LIVE,
          regions: [
            { name: "flat", rect: { height: 0, width: 10, x: 0, y: 0 } },
            { name: "below", rect: { height: 10, width: 10, x: 0, y: 880 } },
          ],
        }),
      ),
    });
    expect(problems).toEqual(["region 'flat' has no area (10x0)", "region 'below' lies outside the 2016x883 frame"]);
  });

  it("carries the scale refusal through", () => {
    expect(
      visualEvidenceErrorLines({
        error: unwrapErr(decideEvidenceCrop({ geometry: { ...LIVE, devicePixelRatio: 3 }, regions: REGIONS })),
      }),
    ).toEqual(["a 2016x883 frame painted at 3 needs at least 6048x2649 image pixels; the capture is 4032x1766"]);
  });

  it("pads by the default when no padding is named", () => {
    const padded = unwrap(decideEvidenceCrop({ geometry: LIVE, regions: REGIONS }));
    const bare = unwrap(decideEvidenceCrop({ geometry: LIVE, paddingCssPx: 0, regions: REGIONS }));
    expect(bare.rect.x - padded.rect.x).toBe(DEFAULT_CROP_PADDING_CSS_PX * 1.5);
  });
});

describe("toImageRect, relativeTo and rectContains", () => {
  it("maps a CSS rectangle outward at the scale", () => {
    expect(toImageRect({ rect: { height: 442, width: 1504, x: 472, y: 441 }, scale: 1.5 })).toEqual({
      height: 1325 - 661,
      width: 2964 - 708,
      x: 708,
      y: 661,
    });
  });

  it("re-expresses a rectangle against a crop's origin", () => {
    expect(
      relativeTo({ crop: { height: 10, width: 10, x: 100, y: 50 }, rect: { height: 5, width: 5, x: 120, y: 60 } }),
    ).toEqual({
      height: 5,
      width: 5,
      x: 20,
      y: 10,
    });
  });

  it("knows containment, edges included", () => {
    const outer = { height: 100, width: 100, x: 0, y: 0 };
    expect(rectContains({ inner: { height: 100, width: 100, x: 0, y: 0 }, outer })).toBe(true);
    expect(rectContains({ inner: { height: 100, width: 101, x: 0, y: 0 }, outer })).toBe(false);
  });
});
