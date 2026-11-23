import { describe, expect, it } from "vitest";

import { overlayHomeOf, overlayOriginOf } from "../../lib/desktopShellPlace";
import {
  anchorOfCentre,
  clampMessengerAnchor,
  DEFAULT_PANEL_SIDE,
  draggedMessengerAnchor,
  isMessengerHome,
  isMessengerPlaceStorage,
  messengerAnchorOf,
  messengerDragTranslate,
  messengerFrameOf,
  messengerPanelRoom,
  messengerPanelSide,
  messengerPlaceStorageOf,
  messengerResizeEdges,
  orbDragCrossed,
  placedWidgetStyle,
} from "../../lib/messengerPlace";
import { MIN_MESSENGER_SIZE } from "../../lib/messengerSize";

const ROOT = 16;

/** A laptop's work area, CSS pixels. */
const ROOM = { height: 945, width: 1512 } as const;

describe("the stored place", () => {
  it.each([
    ["at:120:300", { bottom: 300, right: 120 }],
    ["at:0:16384", { bottom: 16_384, right: 0 }],
    ["at:48:-59", { bottom: -59, right: 48 }],
    ["at:48:-16384", { bottom: -16_384, right: 48 }],
  ] as const)("reads %s", (stored, anchor) => {
    expect(isMessengerPlaceStorage(stored)).toBe(true);
    expect(messengerAnchorOf({ stored })).toEqual(anchor);
    expect(messengerPlaceStorageOf({ anchor })).toBe(stored);
  });

  it("reads the default as no place at all", () => {
    expect(isMessengerPlaceStorage("default")).toBe(true);
    expect(messengerAnchorOf({ stored: "default" })).toBeUndefined();
  });

  it.each([
    [undefined],
    [null],
    [3],
    ["at:120"],
    ["at:1:2:3"],
    ["at:-1:3"],
    ["at:1.5:3"],
    ["at:16385:0"],
    ["at:48:-16385"],
    ["at:48:--3"],
    ["somewhere"],
  ])("refuses %j", (value) => {
    expect(isMessengerPlaceStorage(value)).toBe(false);
  });

  it("keeps a place to whole pixels inside the bounds", () => {
    expect(messengerPlaceStorageOf({ anchor: { bottom: 299.6, right: 120.4 } })).toBe("at:120:300");
    expect(messengerPlaceStorageOf({ anchor: { bottom: -5.4, right: 99_999 } })).toBe("at:16384:-5");
    expect(messengerPlaceStorageOf({ anchor: { bottom: -99_999, right: -3 } })).toBe("at:0:-16384");
  });
});

describe("clampMessengerAnchor", () => {
  it("keeps the orb and its margin inside the work area", () => {
    expect(clampMessengerAnchor({ anchor: { bottom: 0, right: 0 }, room: ROOM, rootFontPx: ROOT })).toEqual({
      bottom: 48,
      right: 48,
    });
  });

  it("keeps the orb clear of the strip a drag's window leaves uncovered on the left", () => {
    expect(clampMessengerAnchor({ anchor: { bottom: 5000, right: 5000 }, room: ROOM, rootFontPx: ROOT })).toEqual({
      bottom: 945 - 48,
      right: 1512 - 48 - 32,
    });
  });

  it("never reaches past the ceiling the shell reads a place up to, on a work area wider than it", () => {
    expect(
      clampMessengerAnchor({
        anchor: { bottom: 30_000, right: 30_000 },
        room: { height: 20_000, width: 20_000 },
        rootFontPx: ROOT,
      }),
    ).toEqual({ bottom: 16_384, right: 16_384 });
    expect(clampMessengerAnchor({ anchor: { bottom: 0, right: 0 }, room: ROOM, rootFontPx: 10_000 })).toEqual({
      bottom: 16_384,
      right: 16_384,
    });
  });

  it("puts the orb in the corner on a screen too small for it", () => {
    expect(
      clampMessengerAnchor({ anchor: { bottom: 30, right: 30 }, room: { height: 50, width: 50 }, rootFontPx: ROOT }),
    ).toEqual({ bottom: 48, right: 48 });
  });

  it("leaves a place already on the screen where it is", () => {
    expect(clampMessengerAnchor({ anchor: { bottom: 400, right: 700 }, room: ROOM, rootFontPx: ROOT })).toEqual({
      bottom: 400,
      right: 700,
    });
  });

  it("lets the orb back down to where it rests level with a Dock below the work area, and no further", () => {
    const home = { bottom: -59 };
    expect(clampMessengerAnchor({ anchor: { bottom: -40, right: 48 }, home, room: ROOM, rootFontPx: ROOT })).toEqual({
      bottom: -40,
      right: 48,
    });
    expect(clampMessengerAnchor({ anchor: { bottom: -500, right: 0 }, home, room: ROOM, rootFontPx: ROOT })).toEqual({
      bottom: -59,
      right: 48,
    });
  });

  it("stops a drag against an edge on a whole pixel under a fractional rem, so the kept place is the place shown", () => {
    const stopped = clampMessengerAnchor({
      anchor: { bottom: 99_999, right: 0 },
      room: { height: 945.5, width: 1512 },
      rootFontPx: 16.2,
    });
    expect(stopped).toEqual({ bottom: 945 - 49, right: 49 });
    expect(messengerAnchorOf({ stored: messengerPlaceStorageOf({ anchor: stopped }) })).toEqual(stopped);
  });

  it("keeps the orb's margin where it rests above the work area's bottom edge, as with no Dock below it", () => {
    expect(
      clampMessengerAnchor({ anchor: { bottom: 0, right: 0 }, home: { bottom: 80 }, room: ROOM, rootFontPx: ROOT }),
    ).toEqual({ bottom: 48, right: 48 });
  });
});

describe("isMessengerHome", () => {
  it.each([
    [{ bottom: -45.6, right: 48 }, true],
    [{ bottom: -45, right: 48 }, false],
    [{ bottom: -45.6, right: 49 }, false],
    [{ bottom: 48, right: 48 }, false],
  ])("is %j home: %s", (anchor, home) => {
    expect(isMessengerHome({ anchor, home: { bottom: -45.6 }, rootFontPx: ROOT })).toBe(home);
  });
});

describe("messengerPanelSide", () => {
  it("opens above and to the left from the corner the orb has always sat in", () => {
    expect(messengerPanelSide({ anchor: { bottom: 48, right: 48 }, room: ROOM })).toEqual(DEFAULT_PANEL_SIDE);
  });

  it("opens below and to the right of an orb dragged to the top left", () => {
    expect(messengerPanelSide({ anchor: { bottom: 800, right: 1400 }, room: ROOM })).toEqual({
      horizontal: "right",
      vertical: "below",
    });
  });

  it("keeps the side it has always opened on for an orb on the middle lines", () => {
    expect(messengerPanelSide({ anchor: { bottom: 472.5, right: 756 }, room: ROOM })).toEqual(DEFAULT_PANEL_SIDE);
  });
});

describe("messengerPanelRoom", () => {
  it("bounds a card below and right of an orb at the top left by the room on that side", () => {
    const anchor = { bottom: 800, right: 1400 };
    const side = messengerPanelSide({ anchor, room: ROOM });
    // Across: 1400 + 28 - 20 = 1408px; up: 800 - 28 - 8 - 20 = 744px.
    expect(messengerPanelRoom({ anchor, room: ROOM, rootFontPx: ROOT, side })).toEqual({
      heightRem: 46.5,
      widthRem: 88,
    });
  });

  it("never lets the window span the screen from the corner", () => {
    // Across: 1512 - 48 + 28 - 20 - 32 = 1440px, held to 1512 - 64 - 32 = 1416px; up: 945 - 48 - 56 = 841px.
    expect(
      messengerPanelRoom({ anchor: { bottom: 48, right: 48 }, room: ROOM, rootFontPx: ROOT, side: DEFAULT_PANEL_SIDE }),
    ).toEqual({ heightRem: 52.56, widthRem: 88.5 });
  });

  it("is never under the smallest size", () => {
    expect(
      messengerPanelRoom({
        anchor: { bottom: 800, right: 1400 },
        room: ROOM,
        rootFontPx: ROOT,
        side: DEFAULT_PANEL_SIDE,
      }),
    ).toEqual(MIN_MESSENGER_SIZE);
  });
});

describe("messengerResizeEdges", () => {
  it("drags the top and left edges from the corner", () => {
    expect(messengerResizeEdges({ side: DEFAULT_PANEL_SIDE })).toEqual(["top", "left", "top-left"]);
  });

  it("drags the bottom and right edges of a card below and right of the orb", () => {
    expect(messengerResizeEdges({ side: { horizontal: "right", vertical: "below" } })).toEqual([
      "bottom",
      "right",
      "bottom-right",
    ]);
  });
});

describe("orbDragCrossed", () => {
  it.each([
    [{ x: 0, y: 0 }, false],
    [{ x: 4, y: 0 }, false],
    [{ x: 0, y: -4 }, false],
    [{ x: 3, y: 3 }, true],
    [{ x: -5, y: 0 }, true],
  ])("is %j a drag: %s", (delta, crossed) => {
    expect(orbDragCrossed({ delta })).toBe(crossed);
  });
});

describe("draggedMessengerAnchor", () => {
  it("puts the orb's centre under the pointer where it was grabbed", () => {
    expect(
      draggedMessengerAnchor({
        drawn: { bottom: 200, right: 200 },
        grab: { x: 2, y: -3 },
        orbCentre: { x: 1000, y: 500 },
        pointer: { x: 902, y: 397 },
        room: ROOM,
        rootFontPx: ROOT,
      }),
    ).toEqual({ bottom: 300, right: 300 });
  });

  it("draws the orb at the whole pixel its place is kept at, so letting go never nudges it", () => {
    const reached = draggedMessengerAnchor({
      drawn: { bottom: 200, right: 200 },
      grab: { x: 0, y: 0 },
      orbCentre: { x: 1000, y: 500 },
      pointer: { x: 899.6, y: 400 },
      room: ROOM,
      rootFontPx: ROOT,
    });
    expect(reached).toEqual({ bottom: 300, right: 300 });
    expect(messengerAnchorOf({ stored: messengerPlaceStorageOf({ anchor: reached }) })).toEqual(reached);
  });

  it("stops the orb at the screen's edge however far the pointer goes", () => {
    expect(
      draggedMessengerAnchor({
        drawn: { bottom: 200, right: 200 },
        grab: { x: 0, y: 0 },
        orbCentre: { x: 1000, y: 500 },
        pointer: { x: 4000, y: 4000 },
        room: ROOM,
        rootFontPx: ROOT,
      }),
    ).toEqual({ bottom: 48, right: 48 });
  });

  it("stops the orb exactly on a zoomed page's fractional home, so a drag pressed into the corner ends home", () => {
    const home = { bottom: -45.6 };
    const reached = draggedMessengerAnchor({
      drawn: { bottom: 200, right: 200 },
      grab: { x: 0, y: 0 },
      home,
      orbCentre: { x: 1000, y: 500 },
      pointer: { x: 4000, y: 4000 },
      room: ROOM,
      rootFontPx: ROOT,
    });
    expect(reached).toEqual({ bottom: -45.6, right: 48 });
    expect(isMessengerHome({ anchor: reached, home, rootFontPx: ROOT })).toBe(true);
  });

  it("stops a drag down along the bottom, away from the corner, on the whole pixel above a fractional home", () => {
    const home = { bottom: -45.6 };
    const reached = draggedMessengerAnchor({
      drawn: { bottom: 200, right: 200 },
      grab: { x: 0, y: 0 },
      home,
      orbCentre: { x: 1000, y: 500 },
      pointer: { x: 1000, y: 4000 },
      room: ROOM,
      rootFontPx: ROOT,
    });
    expect(reached).toEqual({ bottom: -45, right: 200 });
    expect(isMessengerHome({ anchor: reached, home, rootFontPx: ROOT })).toBe(false);
    expect(messengerPlaceStorageOf({ anchor: reached })).toBe("at:200:-45");
  });

  it("stops a drag pressed into the corner on the default's own margin under a fractional rem, so it ends home", () => {
    const home = { bottom: 48 };
    const reached = draggedMessengerAnchor({
      drawn: { bottom: 200, right: 200 },
      grab: { x: 0, y: 0 },
      home,
      orbCentre: { x: 1000, y: 500 },
      pointer: { x: 4000, y: 4000 },
      room: ROOM,
      rootFontPx: 16.1,
    });
    expect(reached.bottom).toBe(48);
    expect(reached.right).toBeCloseTo(48.3, 10);
    expect(isMessengerHome({ anchor: reached, home, rootFontPx: 16.1 })).toBe(true);
  });
});

describe("messengerDragTranslate", () => {
  it("draws a place further from the right and bottom edges further left and up", () => {
    expect(messengerDragTranslate({ rendered: { bottom: 100, right: 100 }, shown: { bottom: 340, right: 600 } })).toBe(
      "translate(-500px, -240px)",
    );
  });

  it("draws a place nearer the corner further right and down", () => {
    expect(messengerDragTranslate({ rendered: { bottom: 300, right: 400 }, shown: { bottom: 48, right: 48 } })).toBe(
      "translate(352px, 252px)",
    );
  });

  it("is no transform at all where the place drawn is the place shown, so a drag's end leaves none behind", () => {
    expect(messengerDragTranslate({ rendered: { bottom: 48, right: 48 }, shown: { bottom: 48, right: 48 } })).toBe("");
  });
});

describe("anchorOfCentre", () => {
  it("reads a place off an orb drawn in a window running under the Dock", () => {
    expect(
      anchorOfCentre({
        centre: { x: 400, y: 300 },
        origin: { bottom: 45, right: 0 },
        viewport: { height: 900, width: 1480 },
      }),
    ).toEqual({ bottom: 555, right: 1080 });
  });

  it("reads a place off an orb drawn in a window cropped inside the work area", () => {
    expect(
      anchorOfCentre({
        centre: { x: 476, y: 576 },
        origin: { bottom: -200, right: -300 },
        viewport: { height: 600, width: 500 },
      }),
    ).toEqual({ bottom: 224, right: 324 });
  });
});

describe("messengerFrameOf", () => {
  it("is the widget's box with its slack, and the orb's centre inside it", () => {
    expect(
      messengerFrameOf({
        orb: { height: 56, left: 492, top: 594, width: 56 },
        widget: { height: 600, left: 100, top: 50, width: 448 },
      }),
    ).toEqual({ height: 648, orbX: 444, orbY: 596, width: 496 });
  });
});

describe("placedWidgetStyle", () => {
  it("hangs the widget off the orb's right and bottom edges, reaching left and up", () => {
    expect(
      placedWidgetStyle({
        anchor: { bottom: 200, right: 300 },
        origin: { bottom: 0, right: 0 },
        side: DEFAULT_PANEL_SIDE,
      }),
    ).toEqual({
      bottom: "calc(200px - 1.75rem)",
      justifyItems: "end",
      left: "auto",
      maxWidth: "none",
      right: "calc(300px - 1.75rem)",
      top: "auto",
    });
  });

  it("hangs the widget off the orb's left and top edges, reaching right and down, by the shell's origin", () => {
    expect(
      placedWidgetStyle({
        anchor: { bottom: 200, right: 300 },
        origin: { bottom: 5, right: -10 },
        side: { horizontal: "right", vertical: "below" },
      }),
    ).toEqual({
      bottom: "auto",
      justifyItems: "start",
      left: "calc(100% - 290px - 1.75rem)",
      maxWidth: "none",
      right: "auto",
      top: "calc(100% - 205px - 1.75rem)",
    });
  });
});

describe("overlayOriginOf", () => {
  it("reads the shell's word, either sign", () => {
    expect(overlayOriginOf({ value: { bottom: -148, right: 117.5 } })).toEqual({ bottom: -148, right: 117.5 });
  });

  it.each([
    [undefined],
    [null],
    [[1, 2]],
    [{ right: 1 }],
    [{ bottom: 1, extra: 0, right: 1 }],
    [{ bottom: "1", right: 1 }],
    [{ bottom: Number.NaN, right: 1 }],
    [{ bottom: 16_385, right: 1 }],
  ])("refuses %j", (value) => {
    expect(overlayOriginOf({ value })).toBeUndefined();
  });
});

describe("overlayHomeOf", () => {
  it("reads the shell's word, either sign", () => {
    expect(overlayHomeOf({ value: { bottom: -45.6 } })).toEqual({ bottom: -45.6 });
    expect(overlayHomeOf({ value: { bottom: 80 } })).toEqual({ bottom: 80 });
  });

  it.each([
    [undefined],
    [null],
    [[1]],
    [{}],
    [{ bottom: 1, right: 1 }],
    [{ bottom: "1" }],
    [{ bottom: Number.POSITIVE_INFINITY }],
    [{ bottom: -16_385 }],
  ])("refuses %j", (value) => {
    expect(overlayHomeOf({ value })).toBeUndefined();
  });
});
