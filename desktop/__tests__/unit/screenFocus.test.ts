/**
 * A region the voice names in its last still lands on your screen where that thing is: placed on the display looked at,
 * clipped to the whole display the voice's window covers, menu bar and Dock included, and turned into the page's CSS
 * pixels.
 */
import { describe, expect, it } from "vitest";

import { focusRectOf, type LookedDisplay } from "../../src/screenFocus";

/** A 1600×1000 display, its menu bar and Dock inside the window's area like everything else. */
const DISPLAY: LookedDisplay = { bounds: { height: 1000, width: 1600, x: 0, y: 0 }, id: 1 };
const AREA = DISPLAY.bounds;
const MIDDLE = { height: 0.125, left: 0.5, top: 0.5, width: 0.25 };

describe("focusRectOf", () => {
  it("places the box on the display, at the display's own origin", () => {
    expect(
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: MIDDLE, zoomFactor: 1 }),
    ).toEqual({ rect: { height: 125, left: 800, top: 500, width: 400 } });
  });

  it("divides by the page's zoom, rounding outward to whole CSS pixels", () => {
    expect([
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: MIDDLE, zoomFactor: 1.25 }),
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: MIDDLE, zoomFactor: 1.5 }),
    ]).toEqual([
      { rect: { height: 100, left: 640, top: 400, width: 320 } },
      { rect: { height: 84, left: 533, top: 333, width: 267 } },
    ]);
  });

  it("lifts a box running over the menu bar or the Dock whole, never clipped at the work area", () => {
    const overMenuBar = { height: 0.125, left: 0, top: 0, width: 0.5 };
    const overDock = { height: 0.125, left: 0, top: 0.875, width: 0.5 };
    expect([
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: overMenuBar, zoomFactor: 1 }),
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: overDock, zoomFactor: 1 }),
    ]).toEqual([
      { rect: { height: 125, left: 0, top: 0, width: 800 } },
      { rect: { height: 125, left: 0, top: 875, width: 800 } },
    ]);
  });

  it("lifts a box wholly in the menu bar", () => {
    const inMenuBar = { height: 0.015625, left: 0.875, top: 0, width: 0.0625 };
    expect(
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: inMenuBar, zoomFactor: 1 }),
    ).toEqual({ rect: { height: 16, left: 1400, top: 0, width: 100 } });
  });

  it("refuses a box too thin to draw round", () => {
    const sliver = { height: 0.005, left: 0.5, top: 0.5, width: 0.25 };
    expect(
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: sliver, zoomFactor: 1 }),
    ).toEqual({ why: "that box is too thin to draw round; say where in words" });
  });

  it("refuses with no look, a changed display, another display, or no zoom", () => {
    const moved: LookedDisplay = { bounds: { height: 1000, width: 1728, x: 0, y: 0 }, id: 1 };
    const other: LookedDisplay = { bounds: DISPLAY.bounds, id: 2 };
    expect([
      focusRectOf({ area: AREA, looked: undefined, now: DISPLAY, primaryId: 1, region: MIDDLE, zoomFactor: 1 }),
      focusRectOf({ area: AREA, looked: DISPLAY, now: moved, primaryId: 1, region: MIDDLE, zoomFactor: 1 }),
      focusRectOf({ area: AREA, looked: other, now: other, primaryId: 1, region: MIDDLE, zoomFactor: 1 }),
      focusRectOf({ area: AREA, looked: DISPLAY, now: DISPLAY, primaryId: 1, region: MIDDLE, zoomFactor: 0 }),
    ]).toEqual([
      { why: "the voice has not looked at the owner's screen yet, so there is nothing to point at" },
      { why: "the owner's screen changed since the voice looked; look again" },
      { why: "the voice can only draw on the owner's main display, and it looked at another one" },
      { why: "the voice's window reports no zoom to draw at" },
    ]);
  });
});
