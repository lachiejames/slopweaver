/**
 * Where the voice's window goes once the owner has dragged its orb somewhere: cropped round the widget at its place,
 * the work area while anything drags, and never off screen; and the origin word that lets the page draw the orb at
 * its place in whichever window holds it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseOverlayPlaceReport } from "../../src/desktopBridge";
import {
  type HeldOverlayReports,
  overlayFitGeometry,
  overlayHome,
  overlayManipulating,
  overlayOrigin,
  placedOverlayBounds,
} from "../../src/overlayPlace";
import { CORNER_SLACK, MANIPULATION_STRIP, overlayPlacement } from "../../src/overlayWindow";
import type { Bounds } from "../../src/persistedState";

/** A MacBook's work area: below the 33-point menu bar, above a 117-point Dock. */
const LAPTOP = { height: 832, width: 1512, x: 0, y: 33 };

/** The same MacBook's whole display. */
const SCREEN = { height: 982, width: 1512, x: 0, y: 0 };

/** Where that MacBook's corner rests the widget's floor (`overlayFloorLine`), the orb's centre level with the Dock's middle. */
const FLOOR = 972;

/** A widget with its card open above and left of the orb: 448 by 600 with 24 of slack, the orb bottom right. */
const FRAME = { height: 648, orbX: 444, orbY: 596, width: 496 };

/** A quiet corner's extent. */
const QUIET = { asks: 0, height: 140.2, wholeArea: false } as const;

/** The page's place module, read for the slack it restates. */
const MESSENGER_PLACE = readFileSync(join(__dirname, "..", "..", "..", "site", "lib", "messengerPlace.ts"), "utf8");

/**
 * Where the page draws the orb's centre on the screen, from the window, the origin word and the place.
 *
 * @param bounds the window
 * @param origin the origin word
 * @param anchor the place
 * @param zoomFactor the page's zoom
 * @returns the orb's centre, screen points
 */
function drawnOrbCentre({
  bounds,
  origin,
  anchor,
  zoomFactor,
}: {
  bounds: Bounds;
  origin: { right: number; bottom: number };
  anchor: { right: number; bottom: number };
  zoomFactor: number;
}): { x: number; y: number } {
  return {
    x: bounds.x + bounds.width - (origin.right + anchor.right) * zoomFactor,
    y: bounds.y + bounds.height - (origin.bottom + anchor.bottom) * zoomFactor,
  };
}

describe("placedOverlayBounds", () => {
  it("crops the window round the widget, the orb's centre on its place", () => {
    const bounds = placedOverlayBounds({
      anchor: { bottom: 200, right: 300 },
      floorLine: FLOOR,
      frame: FRAME,
      manipulating: false,
      workArea: LAPTOP,
      zoomFactor: 1,
    });
    expect(bounds).toEqual({ height: 648, width: 496, x: 768, y: 69 });
    expect(bounds.x + FRAME.orbX).toBe(1512 - 300);
    expect(bounds.y + FRAME.orbY).toBe(33 + 832 - 200);
  });

  it("keeps a window that would run off the screen's top left wholly on it", () => {
    expect(
      placedOverlayBounds({
        anchor: { bottom: 900, right: 1500 },
        floorLine: FLOOR,
        frame: { height: 400, orbX: 52, orbY: 52, width: 500 },
        manipulating: false,
        workArea: LAPTOP,
        zoomFactor: 1,
      }),
    ).toEqual({ height: 400, width: 500, x: 0, y: 33 });
  });

  it("never grows past the work area bar the strip and the floor line, whatever frame is reported", () => {
    expect(
      placedOverlayBounds({
        anchor: { bottom: 100, right: 100 },
        floorLine: FLOOR,
        frame: { height: 3000, orbX: 10, orbY: 10, width: 4000 },
        manipulating: false,
        workArea: LAPTOP,
        zoomFactor: 1,
      }),
    ).toEqual({ height: FLOOR - 33, width: 1512 - MANIPULATION_STRIP, x: MANIPULATION_STRIP, y: 33 });
  });

  it("takes the work area bar the strip while anything drags, down to the floor line below a Dock", () => {
    expect(
      placedOverlayBounds({
        anchor: { bottom: 200, right: 300 },
        floorLine: FLOOR,
        frame: FRAME,
        manipulating: true,
        workArea: LAPTOP,
        zoomFactor: 1,
      }),
    ).toEqual({ height: FLOOR - 33, width: 1480, x: 32, y: 33 });
  });

  it("stops a drag at the work area's own bottom where the floor line sits above it", () => {
    expect(
      placedOverlayBounds({
        anchor: { bottom: 200, right: 300 },
        floorLine: 865 - 40,
        frame: FRAME,
        manipulating: true,
        workArea: LAPTOP,
        zoomFactor: 1,
      }),
    ).toEqual({ height: 832, width: 1480, x: 32, y: 33 });
  });

  it("rests a window round an orb dragged back down level with the Dock, its bottom on the floor line", () => {
    const bounds = placedOverlayBounds({
      anchor: { bottom: -59, right: 48 },
      floorLine: FLOOR,
      frame: FRAME,
      manipulating: false,
      workArea: LAPTOP,
      zoomFactor: 1,
    });
    expect(bounds).toEqual({ height: 648, width: 496, x: 1512 - 496, y: FLOOR - 648 });
  });

  it("scales a zoomed page's frame into screen points", () => {
    expect(
      placedOverlayBounds({
        anchor: { bottom: 300, right: 400 },
        floorLine: FLOOR,
        frame: { height: 400, orbX: 200, orbY: 200, width: 400 },
        manipulating: false,
        workArea: LAPTOP,
        zoomFactor: 1.25,
      }),
    ).toEqual({ height: 500, width: 500, x: 762, y: 240 });
  });
});

describe("overlayHome", () => {
  it("rests the orb's centre level with a Dock below the work area, a negative place", () => {
    expect(overlayHome({ floorLine: FLOOR, workArea: LAPTOP, zoomFactor: 1 })).toEqual({ bottom: -59 });
  });

  it("turns the Dock's screen points into a zoomed page's CSS pixels", () => {
    expect(overlayHome({ floorLine: 982, workArea: LAPTOP, zoomFactor: 1.25 }).bottom).toBeCloseTo(-45.6, 9);
  });

  it("is the orb's lift above the work area's edge where the floor line is that edge", () => {
    expect(overlayHome({ floorLine: 865, workArea: LAPTOP, zoomFactor: 1 })).toEqual({ bottom: 48 });
  });
});

describe("overlayOrigin", () => {
  it("is the Dock's strip below the work area across the whole display", () => {
    expect(overlayOrigin({ placement: { bounds: SCREEN, whole: true }, workArea: LAPTOP, zoomFactor: 1 })).toEqual({
      bottom: 117,
      right: 0,
    });
  });

  it("is negative for a window cropped inside the work area", () => {
    const bounds = { height: 648, width: 496, x: 768, y: 69 };
    expect(overlayOrigin({ placement: { bounds, whole: false }, workArea: LAPTOP, zoomFactor: 1 })).toEqual({
      bottom: -148,
      right: -248,
    });
  });

  it.each([
    [{ bottom: 200, right: 300 }, 1],
    [{ bottom: 900, right: 1500 }, 1],
    [{ bottom: 48, right: 48 }, 1],
    [{ bottom: -59, right: 48 }, 1],
    [{ bottom: 300, right: 400 }, 1.25],
  ])("lets the page draw the orb at %j under zoom %d, at rest and mid-drag", (anchor, zoomFactor) => {
    for (const manipulating of [false, true]) {
      const bounds = placedOverlayBounds({
        anchor,
        floorLine: FLOOR,
        frame: FRAME,
        manipulating,
        workArea: LAPTOP,
        zoomFactor,
      });
      const origin = overlayOrigin({ placement: { bounds, whole: false }, workArea: LAPTOP, zoomFactor });
      const centre = drawnOrbCentre({ anchor, bounds, origin, zoomFactor });
      expect(centre.x).toBeCloseTo(1512 - anchor.right * zoomFactor, 9);
      expect(centre.y).toBeCloseTo(33 + 832 - anchor.bottom * zoomFactor, 9);
    }
  });
});

describe("overlayManipulating", () => {
  const rest: HeldOverlayReports = { extent: QUIET, place: undefined, width: undefined };

  it("is nothing dragging with no report saying so", () => {
    expect(overlayManipulating({ reports: rest })).toBe(false);
  });

  it("is an edge of the card dragging", () => {
    expect(overlayManipulating({ reports: { ...rest, width: { manipulating: true, width: 600 } } })).toBe(true);
  });

  it("is the orb dragging", () => {
    const place = { anchor: { bottom: 200, right: 300 }, frame: FRAME, manipulating: true };
    expect(overlayManipulating({ reports: { ...rest, place } })).toBe(true);
  });
});

describe("overlayFitGeometry", () => {
  const display = { bounds: SCREEN, workArea: LAPTOP };
  const placed = { anchor: { bottom: 200, right: 300 }, frame: FRAME, manipulating: false };
  const fit = ({ reports, expanded = false }: { reports: HeldOverlayReports; expanded?: boolean }) =>
    overlayFitGeometry({ display, expanded, hearsFloor: true, reports, zoomFactor: 1 });

  it("holds the whole display for a page that has reported nothing", () => {
    const { placement, origin } = fit({ reports: { extent: undefined, place: placed, width: undefined } });
    expect(placement).toEqual({ bounds: SCREEN, whole: true });
    expect(origin).toEqual({ bottom: 117, right: 0 });
  });

  it("crops the window round a dragged orb's widget", () => {
    const { area, placement, origin } = fit({ reports: { extent: QUIET, place: placed, width: undefined } });
    expect(placement).toEqual({ bounds: { height: 648, width: 496, x: 768, y: 69 }, whole: false });
    expect(origin).toEqual({ bottom: -148, right: -248 });
    expect(area).toEqual({ asks: 0, whole: false });
  });

  it("holds the whole display for the stage wherever the orb is", () => {
    expect(fit({ expanded: true, reports: { extent: QUIET, place: placed, width: undefined } }).placement).toEqual({
      bounds: SCREEN,
      whole: true,
    });
  });

  it("fits the corner exactly as before for the orb where it has always rested", () => {
    const corner = fit({ reports: { extent: QUIET, place: { ...placed, anchor: null }, width: undefined } });
    const unplaced = fit({ reports: { extent: QUIET, place: undefined, width: undefined } });
    expect(corner).toEqual(unplaced);
    expect(corner.placement).toEqual(
      overlayPlacement({
        cornerWidthCss: undefined,
        display: SCREEN,
        extent: QUIET,
        floorLine: 972,
        manipulating: false,
        wholeArea: false,
        workArea: LAPTOP,
        zoomFactor: 1,
      }),
    );
  });

  it("gives an edge drag beside a dragged orb the work area, down to the floor line", () => {
    const width = { manipulating: true, width: 600 };
    expect(fit({ reports: { extent: QUIET, place: placed, width } }).placement).toEqual({
      bounds: { height: FLOOR - 33, width: 1480, x: 32, y: 33 },
      whole: false,
    });
  });

  it("says where the orb rests with no place of its own, wherever it is now", () => {
    expect(fit({ reports: { extent: QUIET, place: placed, width: undefined } }).home).toEqual({ bottom: -59 });
    expect(fit({ reports: { extent: undefined, place: undefined, width: undefined } }).home).toEqual({ bottom: -59 });
  });
});

describe("parseOverlayPlaceReport", () => {
  const report = { anchor: { bottom: 200, right: 300 }, frame: FRAME, manipulating: false };

  it("reads a place, and the default place as null", () => {
    expect(parseOverlayPlaceReport({ value: report })).toEqual(report);
    expect(parseOverlayPlaceReport({ value: { ...report, anchor: null } })).toEqual({ ...report, anchor: null });
  });

  it("reads a place dragged down level with a Dock below the work area", () => {
    const docked = { ...report, anchor: { bottom: -59.5, right: 48 } };
    expect(parseOverlayPlaceReport({ value: docked })).toEqual(docked);
  });

  it.each([
    [undefined],
    [{ ...report, extra: 1 }],
    [{ anchor: report.anchor, frame: FRAME }],
    [{ ...report, manipulating: "no" }],
    [{ ...report, anchor: { bottom: 200, right: -1 } }],
    [{ ...report, anchor: { bottom: -16_385, right: 300 } }],
    [{ ...report, anchor: { bottom: 200 } }],
    [{ ...report, anchor: { bottom: 200, right: Number.POSITIVE_INFINITY } }],
    [{ ...report, frame: { ...FRAME, width: 0 } }],
    [{ ...report, frame: { ...FRAME, orbX: 497 } }],
    [{ ...report, frame: { ...FRAME, orbY: -1 } }],
    [{ ...report, frame: { height: 648, width: 496 } }],
  ])("refuses %j", (value) => {
    expect(parseOverlayPlaceReport({ value })).toBeUndefined();
  });
});

describe("the page's restatements", () => {
  it("keeps the frame's slack at the corner's, so the shadows, the badge and the X are never clipped", () => {
    expect(MESSENGER_PLACE).toContain(`export const FRAME_SLACK_PX = ${String(CORNER_SLACK)};`);
  });
});
