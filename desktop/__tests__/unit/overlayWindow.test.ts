/**
 * How the voice's window sits over your desktop: the whole display, above the menu bar and the Dock, or its corner on
 * the work area; glass only behind the stage, and every click passed through except over the voice's own controls.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CORNER_LEVEL,
  CORNER_MIN_HEIGHT,
  CORNER_SLACK,
  CORNER_WIDTH,
  DOCK_MIN_STRIP,
  MANIPULATION_STRIP,
  ORB_CENTRE_LIFT,
  overlayCapturesPointer,
  overlayCommandOnBlur,
  overlayControlBounds,
  overlayFloor,
  overlayFloorLine,
  overlayInset,
  overlayLevel,
  overlayPlacement,
  overlayPresentation,
  pointerInOverlay,
  pointerWatchStep,
  pointOnControl,
  TOOLBAR_BAND,
  VIEWPORT_SLACK,
  WHOLE_LEVEL,
} from "../../src/overlayWindow";

/** A MacBook's work area as measured: below the menu bar, beside nothing. */
const LAPTOP = { height: 832, width: 1512, x: 0, y: 33 };

/** The same MacBook's whole display: the 33-point menu bar above that work area, a 117-point Dock below it. */
const SCREEN = { height: 982, width: 1512, x: 0, y: 0 };

/** A page that has said nothing of the messenger's width, and no drag of its edge running. */
const UNSIZED = { cornerWidthCss: undefined, manipulating: false } as const;

/** The page whose widget the shell's floor word places, read for the two sizes {@link ORB_CENTRE_LIFT} restates. */
const VOICE_WIDGET = readFileSync(
  join(__dirname, "..", "..", "..", "site", "components", "voice", "VoiceWidget.tsx"),
  "utf8",
);

/** The page's messenger sizes, read for the corner's clearance and the drag's strip the shell restates. */
const MESSENGER_SIZE = readFileSync(join(__dirname, "..", "..", "..", "site", "lib", "messengerSize.ts"), "utf8");

/** The floor line on that MacBook: the orb's centre on the 117-point Dock strip's centre, 865 + 58.5, rounded up. */
const LEVEL_WITH_DOCK = 924 + ORB_CENTRE_LIFT;

describe("overlayFloorLine", () => {
  const laptop = { display: SCREEN, hearsFloor: true, workArea: LAPTOP } as const;

  it("puts the orb's centre on the Dock strip's centre, below every app window", () => {
    const line = overlayFloorLine({ ...laptop, zoomFactor: 1 });
    expect(line).toBe(LEVEL_WITH_DOCK);
    expect(line - ORB_CENTRE_LIFT - (33 + 832 + 117 / 2)).toBe(0.5);
  });

  it("keeps the whole orb under the work area, so Google Meet's control bar has nothing over it", () => {
    const orbTop = overlayFloorLine({ ...laptop, zoomFactor: 1 }) - ORB_CENTRE_LIFT - 28;
    expect(orbTop - (33 + 832)).toBe(31);
  });

  it("scales the orb's lift by a zoomed page's factor, never past the display's bottom", () => {
    expect(overlayFloorLine({ ...laptop, zoomFactor: 1.1 })).toBe(976);
    expect(overlayFloorLine({ ...laptop, zoomFactor: 1.25 })).toBe(982);
  });

  it("rests the orb the toolbar band above the bottom with the Dock at the side", () => {
    const display = { height: 1080, width: 1920, x: -1920, y: 0 };
    const workArea = { height: 1055, width: 1856, x: -1856, y: 25 };
    expect(overlayFloorLine({ display, hearsFloor: true, workArea, zoomFactor: 1 })).toBe(1080 - TOOLBAR_BAND);
  });

  it("treats an auto-hidden Dock's sliver as no Dock, and keeps the toolbar band", () => {
    const sliver = { ...LAPTOP, height: 982 - 33 - (DOCK_MIN_STRIP - 1) };
    expect(overlayFloorLine({ display: SCREEN, hearsFloor: true, workArea: sliver, zoomFactor: 1 })).toBe(
      33 + sliver.height - TOOLBAR_BAND,
    );
  });

  it("rests on the display's bottom on the smallest Dock strip it counts, as low as the orb's margin allows", () => {
    const smallest = { ...LAPTOP, height: 982 - 33 - DOCK_MIN_STRIP };
    expect(overlayFloorLine({ display: SCREEN, hearsFloor: true, workArea: smallest, zoomFactor: 1 })).toBe(982);
  });

  it("never lifts above the work area's top on a work area shorter than the band", () => {
    const display = { height: 60, width: 400, x: 0, y: 0 };
    const workArea = { height: 50, width: 400, x: 0, y: 10 };
    expect(overlayFloorLine({ display, hearsFloor: true, workArea, zoomFactor: 1 })).toBe(10);
  });

  it("leaves the corner on the work area for a page from before the floor, so its orb never drops as it turns whole", () => {
    expect(overlayFloorLine({ ...laptop, hearsFloor: false, zoomFactor: 1 })).toBe(33 + 832);
  });

  it("restates the widget's bottom margin and half its orb, as VoiceWidget.tsx draws them", () => {
    expect(VOICE_WIDGET).toContain("bottom-[calc(1.25rem_+_var(--sw-orb-floor,0px))]");
    expect(VOICE_WIDGET).toContain('className="relative size-14 ');
    expect(ORB_CENTRE_LIFT).toBe(1.25 * 16 + (14 * 4) / 2);
  });

  it("holds the Small messenger's 28rem and the clearance the page reports around it in the corner's width", () => {
    expect(MESSENGER_SIZE).toContain(
      "export const SMALL_MESSENGER_SIZE: MessengerSize = { heightRem: CORNER_CARD_HEIGHT_REM, widthRem: 28 };",
    );
    expect(MESSENGER_SIZE).toContain("export const CORNER_CLEARANCE_PX = 64;");
    expect(CORNER_WIDTH).toBe(28 * 16 + 64);
  });

  it("leaves the strip the page bounds its widest messenger by uncovered while a drag runs", () => {
    expect(MESSENGER_SIZE).toContain(`const UNCOVERED_STRIP_PX = ${String(MANIPULATION_STRIP)};`);
  });
});

describe("overlayPlacement", () => {
  const quiet = { asks: 0, height: 140.2, wholeArea: false } as const;
  const laptop = { ...UNSIZED, display: SCREEN, floorLine: LEVEL_WITH_DOCK, workArea: LAPTOP } as const;
  const floorLine = LEVEL_WITH_DOCK;

  it("covers exactly the display while no page has reported an extent, a negative origin included", () => {
    const display = { height: 1105, width: 1920, x: -1920, y: 0 };
    const workArea = { height: 1080, width: 1920, x: -1920, y: 25 };
    const unreported = { ...UNSIZED, display, extent: undefined, floorLine, wholeArea: false, workArea, zoomFactor: 1 };
    expect(overlayPlacement(unreported)).toEqual({
      bounds: display,
      whole: true,
    });
  });

  it("covers the whole display, menu bar and Dock included, when the page asks for it", () => {
    expect(
      overlayPlacement({ ...laptop, extent: { ...quiet, wholeArea: true }, wholeArea: false, zoomFactor: 1 }),
    ).toEqual({ bounds: SCREEN, whole: true });
  });

  it("covers the whole display when the shell needs it — the stage up, or a share's frame drawn", () => {
    expect(overlayPlacement({ ...laptop, extent: quiet, wholeArea: true, zoomFactor: 1 })).toEqual({
      bounds: SCREEN,
      whole: true,
    });
  });

  it("shrinks to the widget's corner otherwise, its right edge on the work area's and its bottom on the floor line", () => {
    expect(overlayPlacement({ ...laptop, extent: quiet, wholeArea: false, zoomFactor: 1 })).toEqual({
      bounds: {
        height: 141 + CORNER_SLACK,
        width: CORNER_WIDTH,
        x: 1512 - CORNER_WIDTH,
        y: LEVEL_WITH_DOCK - 141 - CORNER_SLACK,
      },
      whole: false,
    });
  });

  it("runs the corner into the Dock's strip, its right edge where it always was", () => {
    const corner = overlayPlacement({ ...laptop, extent: quiet, wholeArea: false, zoomFactor: 1 }).bounds;
    expect([corner.x + corner.width, corner.y + corner.height - (33 + 832)]).toEqual([1512, 107]);
  });

  it("turns the page's CSS pixels into screen points at a zoomed page's factor", () => {
    const zoomed = overlayFloorLine({ display: SCREEN, hearsFloor: true, workArea: LAPTOP, zoomFactor: 1.25 });
    expect(
      overlayPlacement({ ...laptop, extent: quiet, floorLine: zoomed, wholeArea: false, zoomFactor: 1.25 }).bounds,
    ).toEqual({
      height: 207,
      width: 640,
      x: 1512 - 640,
      y: 982 - 207,
    });
  });

  it("keeps the corner on a display left of the primary's origin", () => {
    const display = { height: 1105, width: 1920, x: -1920, y: 0 };
    const workArea = { height: 1080, width: 1920, x: -1920, y: 25 };
    const sideDock = overlayFloorLine({ display, hearsFloor: true, workArea, zoomFactor: 1 });
    expect(
      overlayPlacement({
        ...UNSIZED,
        display,
        extent: { ...quiet, height: 200 },
        floorLine: sideDock,
        wholeArea: false,
        workArea,
        zoomFactor: 1,
      }).bounds,
    ).toEqual({
      height: 200 + CORNER_SLACK,
      width: CORNER_WIDTH,
      x: -CORNER_WIDTH,
      y: 25 + 1080 - TOOLBAR_BAND - 200 - CORNER_SLACK,
    });
  });

  it("never makes the corner shorter than the orb needs, even for a widget measured before it laid out", () => {
    const zero = { ...quiet, height: 0 };
    expect(overlayPlacement({ ...laptop, extent: zero, wholeArea: false, zoomFactor: 1 }).bounds.height).toBe(
      CORNER_MIN_HEIGHT,
    );
  });

  it("turns a corner clamped to all of its room into the whole display, whose floor still holds the orb's line", () => {
    const display = { height: 340, width: 400, x: 0, y: 0 };
    const small = { height: 300, width: 400, x: 0, y: 0 };
    const tall = { ...quiet, height: 900 };
    const placement = overlayPlacement({
      ...UNSIZED,
      display,
      extent: tall,
      floorLine: 300,
      wholeArea: false,
      workArea: small,
      zoomFactor: 1,
    });
    expect([placement, overlayFloor({ floorLine: 300, placement, zoomFactor: 1 })]).toEqual([
      { bounds: display, whole: true },
      40,
    ]);
  });

  it("rests the corner on the work area itself for a page from before the floor, as it always did", () => {
    const workBottom = overlayFloorLine({ display: SCREEN, hearsFloor: false, workArea: LAPTOP, zoomFactor: 1 });
    expect(
      overlayPlacement({ ...laptop, extent: quiet, floorLine: workBottom, wholeArea: false, zoomFactor: 1 }).bounds,
    ).toEqual({
      height: 141 + CORNER_SLACK,
      width: CORNER_WIDTH,
      x: 1512 - CORNER_WIDTH,
      y: 33 + 832 - 141 - CORNER_SLACK,
    });
  });

  it("keeps a corner that fills the room above the floor line but not the width a corner", () => {
    const display = { height: 340, width: 1000, x: 0, y: 0 };
    const short = { height: 300, width: 1000, x: 0, y: 0 };
    const tall = { ...quiet, height: 900 };
    expect(
      overlayPlacement({
        ...UNSIZED,
        display,
        extent: tall,
        floorLine: 228,
        wholeArea: false,
        workArea: short,
        zoomFactor: 1,
      }),
    ).toEqual({
      bounds: { height: 228, width: CORNER_WIDTH, x: 1000 - CORNER_WIDTH, y: 0 },
      whole: false,
    });
  });
});

describe("overlayFloor", () => {
  const laptop = { ...UNSIZED, display: SCREEN, workArea: LAPTOP } as const;
  const quiet = { asks: 0, height: 140.2, wholeArea: false } as const;
  const whole = { bounds: SCREEN, whole: true } as const;
  const floorLine = LEVEL_WITH_DOCK;

  it("rests the orb on the corner window's own bottom edge", () => {
    const corner = overlayPlacement({ ...laptop, extent: quiet, floorLine, wholeArea: false, zoomFactor: 1 });
    expect(overlayFloor({ floorLine, placement: corner, zoomFactor: 1 })).toBe(0);
  });

  it("lifts the orb off the display's bottom to the Dock's centre while the window runs under the Dock", () => {
    expect(overlayFloor({ floorLine, placement: whole, zoomFactor: 1 })).toBe(982 - LEVEL_WITH_DOCK);
  });

  it("puts the orb on the same screen line in the corner and across the whole display, for every page and zoom", () => {
    const cases = [
      { hearsFloor: true, zoomFactor: 1 },
      { hearsFloor: true, zoomFactor: 1.25 },
      { hearsFloor: false, zoomFactor: 1 },
    ];
    const lines = cases.map(({ hearsFloor, zoomFactor }) => {
      const line = overlayFloorLine({ ...laptop, hearsFloor, zoomFactor });
      const corner = overlayPlacement({ ...laptop, extent: quiet, floorLine: line, wholeArea: false, zoomFactor });
      return [corner, whole].map(
        (placement) =>
          placement.bounds.y +
          placement.bounds.height -
          overlayFloor({ floorLine: line, placement, zoomFactor }) * zoomFactor,
      );
    });
    expect(lines).toEqual([
      [LEVEL_WITH_DOCK, LEVEL_WITH_DOCK],
      [982, 982],
      [33 + 832, 33 + 832],
    ]);
  });

  it("turns screen points into CSS pixels at a zoomed page's factor, rounding up so the orb never dips below its line", () => {
    const line = overlayFloorLine({ ...laptop, hearsFloor: true, zoomFactor: 1.1 });
    expect(overlayFloor({ floorLine: line, placement: whole, zoomFactor: 1.1 })).toBe(6);
  });

  it("rests the orb the band above the screen's bottom with the Dock at the side", () => {
    const display = { height: 1080, width: 1920, x: -1920, y: 0 };
    const workArea = { height: 1055, width: 1856, x: -1856, y: 25 };
    const line = overlayFloorLine({ display, hearsFloor: true, workArea, zoomFactor: 1 });
    expect(overlayFloor({ floorLine: line, placement: { bounds: display, whole: true }, zoomFactor: 1 })).toBe(72);
  });
});

describe("overlayInset", () => {
  it("names the corner's run into the Dock's strip as its only inset edge", () => {
    const quiet = { asks: 0, height: 140.2, wholeArea: false } as const;
    const corner = overlayPlacement({
      ...UNSIZED,
      display: SCREEN,
      extent: quiet,
      floorLine: LEVEL_WITH_DOCK,
      wholeArea: false,
      workArea: LAPTOP,
      zoomFactor: 1,
    });
    expect(overlayInset({ placement: corner, workArea: LAPTOP, zoomFactor: 1 })).toEqual({
      bottom: LEVEL_WITH_DOCK - (33 + 832),
      left: 0,
      right: 0,
      top: 0,
    });
  });

  it("puts the menu bar above the work area and the Dock below it while the window is the whole display", () => {
    expect(overlayInset({ placement: { bounds: SCREEN, whole: true }, workArea: LAPTOP, zoomFactor: 1 })).toEqual({
      bottom: 117,
      left: 0,
      right: 0,
      top: 33,
    });
  });

  it("turns screen points into CSS pixels at a zoomed page's factor, rounding up so nothing sits in the Dock", () => {
    expect(overlayInset({ placement: { bounds: SCREEN, whole: true }, workArea: LAPTOP, zoomFactor: 1.25 })).toEqual({
      bottom: 94,
      left: 0,
      right: 0,
      top: 27,
    });
  });

  it("finds a Dock on the left, on a display left of the primary's origin", () => {
    const display = { height: 1080, width: 1920, x: -1920, y: 0 };
    const workArea = { height: 1055, width: 1856, x: -1856, y: 25 };
    expect(overlayInset({ placement: { bounds: display, whole: true }, workArea, zoomFactor: 1 })).toEqual({
      bottom: 0,
      left: 64,
      right: 0,
      top: 25,
    });
  });

  it("has no inset in the corner, whose edges are the work area's", () => {
    const corner = { bounds: { height: 165, width: CORNER_WIDTH, x: 1512 - CORNER_WIDTH, y: 700 }, whole: false };
    expect(overlayInset({ placement: corner, workArea: LAPTOP, zoomFactor: 1 })).toEqual({
      bottom: 0,
      left: 0,
      right: 0,
      top: 0,
    });
  });
});

describe("overlayLevel", () => {
  // The menu bar's own level, under the ⌘⇧5 veil Screenshot draws there after it; one level, so a fit never re-orders.
  it("sets the menu bar's level whole or in the corner, so a fit never lifts the window above a ⌘⇧5 veil", () => {
    const whole = overlayLevel({ placement: { bounds: SCREEN, whole: true } });
    const corner = overlayLevel({ placement: { bounds: LAPTOP, whole: false } });
    expect([whole, corner, WHOLE_LEVEL, CORNER_LEVEL]).toEqual(["main-menu", "main-menu", "main-menu", "main-menu"]);
  });
});

describe("overlayPresentation", () => {
  it("puts the glass behind the stage and takes the keyboard", () => {
    expect(overlayPresentation({ mode: "expanded" })).toEqual({ focus: true, vibrancy: "under-window" });
  });

  it("has no glass behind the orb, which would blur your whole desktop, and leaves the keyboard alone", () => {
    expect(overlayPresentation({ mode: "collapsed" })).toEqual({ focus: false, vibrancy: null });
  });
});

describe("overlayCapturesPointer", () => {
  it("takes every click while the stage is up", () => {
    expect(overlayCapturesPointer({ manipulating: false, mode: "expanded", overInteractive: false })).toBe(true);
  });

  it("takes a click over the orb while collapsed", () => {
    expect(overlayCapturesPointer({ manipulating: false, mode: "collapsed", overInteractive: true })).toBe(true);
  });

  it("keeps the pointer through a drag of the messenger's edge, wherever the pointer is", () => {
    expect(overlayCapturesPointer({ manipulating: true, mode: "collapsed", overInteractive: false })).toBe(true);
  });

  it("passes every other click through to what you are working in", () => {
    expect(overlayCapturesPointer({ manipulating: false, mode: "collapsed", overInteractive: false })).toBe(false);
  });
});

describe("pointerInOverlay", () => {
  const corner = { height: 300, width: 448, x: 1064, y: 600 };
  // The orb's centre on the screen: 20px margin plus half the 56px orb in from the work area's right edge.
  const onTheOrb = { x: 1464, y: 700 };

  it("finds a pointer resting on the orb in the corner window", () => {
    expect(pointerInOverlay({ bounds: corner, cursor: onTheOrb, zoomFactor: 1 })).toEqual({ x: 400, y: 100 });
  });

  it("finds the same resting pointer once the messenger turns the window whole, where the orb still is", () => {
    expect(pointerInOverlay({ bounds: SCREEN, cursor: onTheOrb, zoomFactor: 1 })).toEqual({ x: 1464, y: 700 });
  });

  it("turns screen points into a zoomed page's CSS pixels", () => {
    expect(pointerInOverlay({ bounds: corner, cursor: onTheOrb, zoomFactor: 1.25 })).toEqual({ x: 320, y: 80 });
  });

  it("places a pointer on a display left of the primary's origin", () => {
    const left = { height: 900, width: 1440, x: -1440, y: 0 };
    expect(pointerInOverlay({ bounds: left, cursor: { x: -40, y: 10 }, zoomFactor: 1 })).toEqual({ x: 1400, y: 10 });
  });

  it("has no position for a pointer off the corner, which a move onto it finds by itself", () => {
    expect(pointerInOverlay({ bounds: corner, cursor: { x: 1000, y: 700 }, zoomFactor: 1 })).toBeUndefined();
    expect(pointerInOverlay({ bounds: corner, cursor: { x: 1200, y: 599 }, zoomFactor: 1 })).toBeUndefined();
  });

  it("counts the window's left and top edges as on it, its right and bottom edges as past it", () => {
    expect(pointerInOverlay({ bounds: corner, cursor: { x: 1064, y: 600 }, zoomFactor: 1 })).toEqual({ x: 0, y: 0 });
    expect(pointerInOverlay({ bounds: corner, cursor: { x: 1512, y: 700 }, zoomFactor: 1 })).toBeUndefined();
    expect(pointerInOverlay({ bounds: corner, cursor: { x: 1200, y: 900 }, zoomFactor: 1 })).toBeUndefined();
  });

  it("places nothing by a zoom no page can have", () => {
    const zooms = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    expect(zooms.map((zoomFactor) => pointerInOverlay({ bounds: corner, cursor: onTheOrb, zoomFactor }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

// A press on the orb from another app reached the wallpaper and macOS revealed the desktop.
// Main takes the pointer off where the page says its controls are, measured on the owner's own corner (1064,852 448x120).
describe("overlayControlBounds", () => {
  const corner = { height: 120, width: 448, x: 1064, y: 852 };
  const orb = { height: 56, left: 372, top: 44, width: 56 };
  const inCorner = { boxes: [orb], viewport: { height: 120, width: 448 } };

  it("places the orb on screen at the corner's origin", () => {
    expect(overlayControlBounds({ bounds: corner, report: inCorner, zoomFactor: 1 })).toEqual([
      { height: 56, width: 56, x: 1436, y: 896 },
    ]);
  });

  it("scales a zoomed page's CSS pixels into screen points", () => {
    const zoomed = { boxes: [{ height: 56, left: 290, top: 30, width: 56 }], viewport: { height: 96, width: 358.4 } };
    expect(overlayControlBounds({ bounds: corner, report: zoomed, zoomFactor: 1.25 })).toEqual([
      { height: 70, width: 70, x: 1426.5, y: 889.5 },
    ]);
  });

  it("places a box on a display with a negative origin", () => {
    const left = { height: 120, width: 448, x: -1600, y: -200 };
    expect(overlayControlBounds({ bounds: left, report: inCorner, zoomFactor: 1 })).toEqual([
      { height: 56, width: 56, x: -1228, y: -156 },
    ]);
  });

  it("clips a box to the window on every edge, and drops one clipped away", () => {
    const report = {
      boxes: [
        { height: 40, left: -10, top: -20, width: 30 },
        { height: 50, left: 430, top: 100, width: 50 },
        { height: 10, left: 500, top: 10, width: 10 },
      ],
      viewport: { height: 120, width: 448 },
    };
    expect(overlayControlBounds({ bounds: corner, report, zoomFactor: 1 })).toEqual([
      { height: 20, width: 20, x: 1064, y: 852 },
      { height: 20, width: 18, x: 1494, y: 952 },
    ]);
  });

  it("cannot place a report measured before a fit resized the window", () => {
    const whole = { height: 982, width: 1512, x: 0, y: 0 };
    expect(overlayControlBounds({ bounds: whole, report: inCorner, zoomFactor: 1 })).toBeUndefined();
  });

  it("places a report of no controls as no boxes, a judgement rather than nothing to judge", () => {
    const none = { boxes: [], viewport: { height: 120, width: 448 } };
    expect(overlayControlBounds({ bounds: corner, report: none, zoomFactor: 1 })).toEqual([]);
  });

  it("takes a viewport off by a rounding point, and refuses one past the slack", () => {
    const rounded = { boxes: [orb], viewport: { height: 120 + VIEWPORT_SLACK, width: 448 - VIEWPORT_SLACK } };
    const past = { boxes: [orb], viewport: { height: 120 + VIEWPORT_SLACK + 1, width: 448 } };
    expect(overlayControlBounds({ bounds: corner, report: rounded, zoomFactor: 1 })!.length).toBe(1);
    expect(overlayControlBounds({ bounds: corner, report: past, zoomFactor: 1 })).toBeUndefined();
  });

  it("cannot place a report under a zoom no page can have", () => {
    const zooms = [0, -1, Number.NaN, Number.POSITIVE_INFINITY];
    expect(zooms.map((zoomFactor) => overlayControlBounds({ bounds: corner, report: inCorner, zoomFactor }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("pointerWatchStep", () => {
  /** Feed readings in order from a page saying over, against boxes it reported after it did, returning each step. */
  const run = ({
    readings,
    watchOver,
  }: {
    readings: readonly (boolean | undefined)[];
    watchOver: boolean;
  }): ReturnType<typeof pointerWatchStep>[] => {
    const steps: ReturnType<typeof pointerWatchStep>[] = [];
    let state = { disagreeing: 0, pageOver: true, watchOver };
    for (const next of readings) {
      const step = pointerWatchStep({ ...state, next, pageMeasured: true });
      steps.push(step);
      state = { disagreeing: step.disagreeing, pageOver: step.pageOver, watchOver: step.watchOver };
    }
    return steps;
  };

  it("drops a hung page's over on the third reading off every control after the cursor leaves one", () => {
    const steps = run({ readings: [false, false, false], watchOver: true });
    expect(steps.map((step) => [step.pageOver, step.pageDropped, step.changed])).toEqual([
      [true, false, true],
      [true, false, false],
      [false, true, true],
    ]);
    expect(steps[2]!.disagreeing).toBe(0);
  });

  it("drops it the same when the page won the race and the watch never saw the cursor on a control", () => {
    const steps = run({ readings: [false, false, false], watchOver: false });
    expect(steps.map((step) => [step.pageOver, step.pageDropped])).toEqual([
      [true, false],
      [true, false],
      [false, true],
    ]);
  });

  it("keeps the page's over through two readings, so a control the page sees a frame before main is not flapped", () => {
    const steps = run({ readings: [false, false, true], watchOver: false });
    expect(steps.map((step) => [step.pageOver, step.watchOver, step.disagreeing])).toEqual([
      [true, false, 1],
      [true, false, 2],
      [true, true, 0],
    ]);
  });

  it("never counts a reading that could not judge, so a resize under a held pointer never drops it", () => {
    const steps = run({ readings: [false, false, undefined, false, false], watchOver: false });
    expect(steps.map((step) => [step.pageOver, step.disagreeing])).toEqual([
      [true, 1],
      [true, 2],
      [true, 0],
      [true, 1],
      [true, 2],
    ]);
  });

  it("never counts boxes from before the page's answer against it, so a control that moved under the cursor holds", () => {
    const stale = { next: false, pageMeasured: false, pageOver: true, watchOver: false };
    const first = pointerWatchStep({ ...stale, disagreeing: 0 });
    const second = pointerWatchStep({ ...stale, disagreeing: first.disagreeing });
    const third = pointerWatchStep({ ...stale, disagreeing: second.disagreeing });
    expect([first, second, third].map((step) => [step.pageOver, step.pageDropped, step.disagreeing])).toEqual([
      [true, false, 0],
      [true, false, 0],
      [true, false, 0],
    ]);
  });

  it("holds a pointer only the watch took through a reading that could not judge, the orb's own press", () => {
    expect(
      pointerWatchStep({ disagreeing: 0, next: undefined, pageMeasured: true, pageOver: false, watchOver: true }),
    ).toEqual({
      changed: false,
      disagreeing: 0,
      pageDropped: false,
      pageOver: false,
      watchOver: true,
    });
  });

  it("never takes the pointer on a reading that could not judge", () => {
    expect(
      pointerWatchStep({ disagreeing: 0, next: undefined, pageMeasured: true, pageOver: false, watchOver: false }),
    ).toEqual({
      changed: false,
      disagreeing: 0,
      pageDropped: false,
      pageOver: false,
      watchOver: false,
    });
  });

  it("releases a held pointer on the first reading that can judge once more and finds the cursor off", () => {
    const steps = run({ readings: [undefined, undefined, false], watchOver: true });
    expect(steps.map((step) => [step.watchOver, step.changed])).toEqual([
      [true, false],
      [true, false],
      [false, true],
    ]);
  });

  it("takes the pointer on the watch's own word when it comes on a control before the page does", () => {
    expect(
      pointerWatchStep({ disagreeing: 0, next: true, pageMeasured: true, pageOver: false, watchOver: false }),
    ).toEqual({
      changed: true,
      disagreeing: 0,
      pageDropped: false,
      pageOver: false,
      watchOver: true,
    });
  });

  it("changes nothing while the cursor stays on a control", () => {
    expect(
      pointerWatchStep({ disagreeing: 0, next: true, pageMeasured: true, pageOver: true, watchOver: true }),
    ).toEqual({
      changed: false,
      disagreeing: 0,
      pageDropped: false,
      pageOver: true,
      watchOver: true,
    });
  });
});

describe("pointOnControl", () => {
  const orb = { height: 56, width: 56, x: 1436, y: 896 };
  const card = { height: 400, width: 384, x: 1084, y: 400 };

  it("is over the orb at its centre and at its top left edge", () => {
    expect(
      [
        { x: 1464, y: 924 },
        { x: 1436, y: 896 },
      ].map((point) => pointOnControl({ boxes: [orb], point })),
    ).toEqual([true, true]);
  });

  it("is off the orb on its right and bottom edges and beside it, so the wallpaper there keeps its clicks", () => {
    const points = [
      { x: 1492, y: 924 },
      { x: 1464, y: 952 },
      { x: 1430, y: 924 },
    ];
    expect(points.map((point) => pointOnControl({ boxes: [orb], point }))).toEqual([false, false, false]);
  });

  it("is over any one of several controls and off the gap between them", () => {
    const points = [
      { x: 1200, y: 500 },
      { x: 1464, y: 924 },
      { x: 1464, y: 850 },
    ];
    expect(points.map((point) => pointOnControl({ boxes: [card, orb], point }))).toEqual([true, true, false]);
  });

  it("is over nothing with no control placed", () => {
    expect(pointOnControl({ boxes: [], point: { x: 1464, y: 924 } })).toBe(false);
  });
});

describe("overlayCommandOnBlur", () => {
  const leftTheStage = { callActive: false, focusOwned: false, listening: true, live: true, mode: "expanded" } as const;

  it("folds the stage away to the orb, never collapses it, when you switch to another app", () => {
    expect(overlayCommandOnBlur(leftTheStage)).toBe("fold");
  });

  it("folds the options beside the orb when you click into another app from the corner", () => {
    expect(overlayCommandOnBlur({ ...leftTheStage, mode: "collapsed" })).toBe("fold");
  });

  it("keeps the messenger open on a call when another app takes focus, a Playwright window included", () => {
    expect(overlayCommandOnBlur({ ...leftTheStage, callActive: true, mode: "collapsed" })).toBeUndefined();
  });

  it("still folds the stage on a call, so it never stays over the app that took focus", () => {
    expect(overlayCommandOnBlur({ ...leftTheStage, callActive: true })).toBe("fold");
  });

  it("sends nothing in any view when focus lands on one of Slopweaver's own windows", () => {
    const modes = ["expanded", "collapsed"] as const;
    expect(modes.map((mode) => overlayCommandOnBlur({ ...leftTheStage, focusOwned: true, mode }))).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("sends nothing before the page has reported a view", () => {
    expect(overlayCommandOnBlur({ ...leftTheStage, mode: undefined })).toBeUndefined();
  });

  it("sends nothing to a page that is going away", () => {
    expect(overlayCommandOnBlur({ ...leftTheStage, listening: false })).toBeUndefined();
  });

  it("sends nothing through a window being torn down or already replaced", () => {
    expect(overlayCommandOnBlur({ ...leftTheStage, live: false })).toBeUndefined();
  });
});
