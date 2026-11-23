import { describe, expect, it } from "vitest";

import {
  CORNER_CLEARANCE_PX,
  cardDragDeltaPx,
  cardGrabPx,
  cornerWidthPx,
  fitMessenger,
  isMessengerSizeStorage,
  LARGE_MESSENGER_SIZE,
  type MessengerSize,
  MIN_MESSENGER_SIZE,
  messengerMaximum,
  messengerRoomy,
  messengerSizeMenu,
  messengerSizeOf,
  messengerSizeStorageOf,
  resizeMessenger,
  SMALL_MESSENGER_SIZE,
  screenRoomCssPx,
} from "../../lib/messengerSize";

const ROOT = 16;
const ROOMY: MessengerSize = { heightRem: 60, widthRem: 80 };

describe("the presets", () => {
  it("opens Small at today's size and Large a fifth taller, as wide", () => {
    expect(SMALL_MESSENGER_SIZE).toEqual({ heightRem: 34.2, widthRem: 28 });
    expect(LARGE_MESSENGER_SIZE).toEqual({ heightRem: 41.04, widthRem: 28 });
  });

  it("lists Small, Large, Full screen, then the reset of size and position", () => {
    expect(messengerSizeMenu().map((row) => row.label)).toEqual([
      "Small",
      "Large",
      "Full screen",
      "Reset size and position",
    ]);
    expect(messengerSizeMenu().map((row) => row.action)).toEqual(["small", "large", "fullscreen", "reset"]);
  });

  it("sizes today's corner exactly as the shell's static width", () => {
    expect(CORNER_CLEARANCE_PX).toBe(64);
    expect(cornerWidthPx({ rootFontPx: ROOT, size: SMALL_MESSENGER_SIZE })).toBe(512);
    expect(cornerWidthPx({ rootFontPx: ROOT, size: { heightRem: 30, widthRem: 40.03 } })).toBe(705);
  });
});

describe("the stored size", () => {
  it.each([
    ["small", SMALL_MESSENGER_SIZE],
    ["large", LARGE_MESSENGER_SIZE],
    ["custom:40:30.5", { heightRem: 30.5, widthRem: 40 }],
  ] as const)("reads %s", (stored, size) => {
    expect(isMessengerSizeStorage(stored)).toBe(true);
    expect(messengerSizeOf({ canWiden: true, stored })).toEqual(size);
    expect(messengerSizeStorageOf({ size })).toBe(stored);
  });

  it("draws a wide kept size at the default width under a shell that cannot widen, its height kept", () => {
    expect(messengerSizeOf({ canWiden: false, stored: "custom:40:30.5" })).toEqual({
      heightRem: 30.5,
      widthRem: SMALL_MESSENGER_SIZE.widthRem,
    });
  });

  it.each([
    [undefined],
    [null],
    [3],
    ["medium"],
    ["custom:40"],
    ["custom:40:30:1"],
    ["custom:27.9:30"],
    ["custom:40:17"],
    ["custom:401:30"],
    ["custom:NaN:30"],
    ["custom:-40:30"],
    ["custom:40:30.123"],
    ["custom:Infinity:30"],
  ])("refuses %j", (value) => {
    expect(isMessengerSizeStorage(value)).toBe(false);
  });

  it("keeps a dragged size to two places", () => {
    expect(messengerSizeStorageOf({ size: { heightRem: 30.123_456, widthRem: 40.005 } })).toBe("custom:40.01:30.12");
  });
});

describe("cardDragDeltaPx", () => {
  const start: MessengerSize = { heightRem: 30, widthRem: 28 };
  // A card drawn at its start size, its right and bottom edges at 1000 and 900.
  const cardPx = { bottom: 900, left: 552, right: 1000, top: 420 };

  it("puts the left edge under the pointer, wherever the press landed on it", () => {
    const deltaPx = cardDragDeltaPx({
      cardPx,
      edge: "left",
      grabPx: { x: 3, y: 0 },
      pointerPx: { x: 395, y: 0 },
      rootFontPx: ROOT,
      start,
    });
    const reached = resizeMessenger({ deltaPx, edge: "left", maximum: ROOMY, rootFontPx: ROOT, start });
    expect(reached).toEqual({ heightRem: start.heightRem, widthRem: 38 });
  });

  it("puts the right and bottom edges under the pointer for a card opened below and right of the orb", () => {
    const deltaPx = cardDragDeltaPx({
      cardPx,
      edge: "bottom-right",
      grabPx: { x: -2, y: -1 },
      pointerPx: { x: 1158, y: 931 },
      rootFontPx: ROOT,
      start,
    });
    expect(deltaPx).toEqual({ x: 160, y: 32 });
    const reached = resizeMessenger({ deltaPx, edge: "bottom-right", maximum: ROOMY, rootFontPx: ROOT, start });
    expect(reached).toEqual({ heightRem: 32, widthRem: 38 });
  });

  it("is a plain zero on the axis an edge does not move", () => {
    const deltaPx = cardDragDeltaPx({
      cardPx,
      edge: "right",
      grabPx: { x: 0, y: 0 },
      pointerPx: { x: 1016, y: 5000 },
      rootFontPx: ROOT,
      start,
    });
    expect(deltaPx).toEqual({ x: 16, y: 0 });
    expect(Object.is(deltaPx.y, 0)).toBe(true);
  });

  it("is no movement for a press let go where it landed", () => {
    expect(
      cardDragDeltaPx({
        cardPx,
        edge: "top-left",
        grabPx: { x: 2, y: 4 },
        pointerPx: { x: cardPx.left + 2, y: cardPx.top + 4 },
        rootFontPx: ROOT,
        start,
      }),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("cardGrabPx", () => {
  const cardPx = { bottom: 900, left: 552, right: 1000, top: 420 };

  it("measures a press from the left and top edges it drags", () => {
    expect(cardGrabPx({ cardPx, edge: "top-left", pressPx: { x: 555, y: 424 } })).toEqual({ x: 3, y: 4 });
  });

  it("measures a press from the right and bottom edges it drags", () => {
    expect(cardGrabPx({ cardPx, edge: "bottom-right", pressPx: { x: 997, y: 898 } })).toEqual({ x: -3, y: -2 });
  });

  it("is zero on the axis an edge does not move", () => {
    expect(cardGrabPx({ cardPx, edge: "bottom", pressPx: { x: 700, y: 897 } })).toEqual({ x: 0, y: -3 });
  });
});

describe("messengerRoomy", () => {
  it("has room on a laptop screen", () => {
    expect(messengerRoomy({ rootFontPx: ROOT, screenPx: { height: 945, width: 1512 } })).toBe(true);
  });

  it("has none when a page zoomed far in leaves the screen narrower than the smallest messenger", () => {
    expect(messengerRoomy({ rootFontPx: ROOT, screenPx: { height: 945, width: 378 } })).toBe(false);
  });

  it("has none when the screen is too short for it", () => {
    expect(messengerRoomy({ rootFontPx: ROOT, screenPx: { height: 300, width: 1512 } })).toBe(false);
  });
});

describe("screenRoomCssPx", () => {
  const availPx = { height: 945, width: 1512 };

  it("reads a zoomed screen in the page's CSS pixels", () => {
    expect(screenRoomCssPx({ availPx, innerWidth: 400, outerWidth: 500 })).toEqual({ height: 756, width: 1209.6 });
  });

  it("is the screen as reported at no zoom", () => {
    expect(screenRoomCssPx({ availPx, innerWidth: 512, outerWidth: 512 })).toEqual(availPx);
  });

  it("is the screen as reported for a window not yet laid out", () => {
    expect(screenRoomCssPx({ availPx, innerWidth: 0, outerWidth: 0 })).toEqual(availPx);
  });
});

describe("fitMessenger", () => {
  it("draws a size kept on a larger display at the room this one has", () => {
    expect(fitMessenger({ maximum: { heightRem: 40, widthRem: 56.5 }, size: { heightRem: 30, widthRem: 80 } })).toEqual(
      {
        heightRem: 30,
        widthRem: 56.5,
      },
    );
  });

  it("never grows a size that fits", () => {
    expect(fitMessenger({ maximum: ROOMY, size: SMALL_MESSENGER_SIZE })).toEqual(SMALL_MESSENGER_SIZE);
  });
});

describe("resizeMessenger", () => {
  const start = SMALL_MESSENGER_SIZE;

  it("widens as the left edge moves left, the height untouched", () => {
    expect(
      resizeMessenger({ deltaPx: { x: -64, y: -64 }, edge: "left", maximum: ROOMY, rootFontPx: ROOT, start }),
    ).toEqual({ heightRem: 34.2, widthRem: 32 });
  });

  it("heightens as the top edge moves up, the width untouched", () => {
    expect(
      resizeMessenger({ deltaPx: { x: -64, y: -32 }, edge: "top", maximum: ROOMY, rootFontPx: ROOT, start }),
    ).toEqual({ heightRem: 36.2, widthRem: 28 });
  });

  it("moves both from the corner", () => {
    expect(
      resizeMessenger({ deltaPx: { x: -32, y: -32 }, edge: "top-left", maximum: ROOMY, rootFontPx: ROOT, start }),
    ).toEqual({ heightRem: 36.2, widthRem: 30 });
  });

  it("grows the right and bottom edges as they move right and down", () => {
    expect(
      resizeMessenger({ deltaPx: { x: 64, y: 32 }, edge: "bottom-right", maximum: ROOMY, rootFontPx: ROOT, start }),
    ).toEqual({ heightRem: 36.2, widthRem: 32 });
  });

  it("never goes under the smallest", () => {
    expect(
      resizeMessenger({ deltaPx: { x: 400, y: 400 }, edge: "top-left", maximum: ROOMY, rootFontPx: ROOT, start }),
    ).toEqual(MIN_MESSENGER_SIZE);
  });

  it("never goes past the largest", () => {
    const maximum = { heightRem: 40, widthRem: 30 };
    expect(
      resizeMessenger({ deltaPx: { x: -400, y: -400 }, edge: "top-left", maximum, rootFontPx: ROOT, start }),
    ).toEqual(maximum);
  });
});

describe("messengerMaximum", () => {
  it("is the screen less the corner's clearance and an uncovered strip across, and the card's clearance up", () => {
    expect(messengerMaximum({ canWiden: true, rootFontPx: ROOT, screenPx: { height: 960, width: 1504 } })).toEqual({
      heightRem: 50.2,
      widthRem: 88,
    });
  });

  it("keeps today's width under a shell that cannot widen its corner", () => {
    expect(
      messengerMaximum({ canWiden: false, rootFontPx: ROOT, screenPx: { height: 960, width: 1504 } }).widthRem,
    ).toBe(28);
  });

  it("is never under the smallest on a tiny screen", () => {
    expect(messengerMaximum({ canWiden: true, rootFontPx: ROOT, screenPx: { height: 200, width: 300 } })).toEqual(
      MIN_MESSENGER_SIZE,
    );
  });
});
