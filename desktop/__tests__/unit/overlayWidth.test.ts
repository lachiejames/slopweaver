/**
 * How wide the voice's corner is for the messenger the owner sized: the page's width report read off the wire, the
 * corner it widens, and the room a drag of the messenger's edge takes.
 */
import { describe, expect, it } from "vitest";

import { parseOverlayWidthReport } from "../../src/desktopBridge";
import { CORNER_SLACK, CORNER_WIDTH, MANIPULATION_STRIP, overlayPlacement } from "../../src/overlayWindow";

/** A MacBook's work area below the menu bar, and its whole display. */
const LAPTOP = { height: 832, width: 1512, x: 0, y: 33 };
const SCREEN = { height: 982, width: 1512, x: 0, y: 0 };

/** The corner as the shell places it for a quiet widget resting on the work area's bottom. */
const CORNER = {
  display: SCREEN,
  extent: { asks: 0, height: 140, wholeArea: false },
  floorLine: 33 + 832,
  wholeArea: false,
  workArea: LAPTOP,
  zoomFactor: 1,
} as const;

describe("parseOverlayWidthReport", () => {
  it("reads a width and whether a drag holds the pointer", () => {
    expect(parseOverlayWidthReport({ value: { manipulating: true, width: 705 } })).toEqual({
      manipulating: true,
      width: 705,
    });
  });

  it.each([
    [undefined],
    [null],
    [705],
    [{ width: 705 }],
    [{ manipulating: "yes", width: 705 }],
    [{ manipulating: false, width: "705" }],
    [{ manipulating: false, width: 0 }],
    [{ manipulating: false, width: -1 }],
    [{ manipulating: false, width: Number.NaN }],
    [{ manipulating: false, width: Number.POSITIVE_INFINITY }],
    [{ manipulating: false, width: 16_385 }],
    [{ manipulating: false, width: 705, extra: 1 }],
  ])("refuses %j", (value) => {
    expect(parseOverlayWidthReport({ value })).toBe(undefined);
  });
});

describe("overlayPlacement with a width report", () => {
  const corner = ({ cornerWidthCss }: { cornerWidthCss: number | undefined }) =>
    overlayPlacement({ ...CORNER, cornerWidthCss, manipulating: false }).bounds;

  it("keeps the default corner for a page that reports no width", () => {
    expect(corner({ cornerWidthCss: undefined }).width).toBe(CORNER_WIDTH);
  });

  it("widens the corner to the messenger the owner sized, its right edge where it always was", () => {
    const wide = corner({ cornerWidthCss: 705 });
    expect([wide.width, wide.x + wide.width]).toEqual([705, 1512]);
  });

  it("never narrows the corner under the default, whatever a report says", () => {
    expect(corner({ cornerWidthCss: 100 }).width).toBe(CORNER_WIDTH);
  });

  it("widens by the page's zoom, as the height does", () => {
    const zoomed = overlayPlacement({ ...CORNER, cornerWidthCss: 705, manipulating: false, zoomFactor: 1.25 }).bounds;
    expect(zoomed.width).toBe(882);
  });
});

describe("overlayPlacement while a drag runs", () => {
  it("takes the work area bar the strip, from the work area's top to the floor, so the edge can follow the cursor", () => {
    expect(overlayPlacement({ ...CORNER, cornerWidthCss: 512, manipulating: true })).toEqual({
      bounds: { height: 832, width: 1512 - MANIPULATION_STRIP, x: MANIPULATION_STRIP, y: 33 },
      whole: false,
    });
  });

  it("keeps the corner's right and bottom edges, so the card under the cursor never moves as the drag begins", () => {
    const resting = overlayPlacement({ ...CORNER, cornerWidthCss: 512, manipulating: false }).bounds;
    const dragging = overlayPlacement({ ...CORNER, cornerWidthCss: 512, manipulating: true }).bounds;
    expect([resting.x + resting.width, resting.y + resting.height, resting.height]).toEqual([
      1512,
      33 + 832,
      140 + CORNER_SLACK,
    ]);
    expect([dragging.x + dragging.width, dragging.y + dragging.height]).toEqual([1512, 33 + 832]);
  });

  it("still gives the stage the whole display", () => {
    expect(overlayPlacement({ ...CORNER, cornerWidthCss: 512, manipulating: true, wholeArea: true })).toEqual({
      bounds: SCREEN,
      whole: true,
    });
  });
});
