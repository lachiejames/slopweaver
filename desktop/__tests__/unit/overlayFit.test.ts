/**
 * Applying a fit to the voice's window: whether a move hides the window until its page has drawn at the new bounds,
 * and the word the page hears on whether the window is whole.
 */
import { describe, expect, it } from "vitest";

import { CORNER_WIDTH, overlayAreaWord, overlayMoveHides } from "../../src/overlayWindow";

/** A MacBook's work area as measured: below the menu bar, beside nothing. */
const LAPTOP = { height: 832, width: 1512, x: 0, y: 33 };

/** The same MacBook's whole display: the 33-point menu bar above that work area, a 117-point Dock below it. */
const SCREEN = { height: 982, width: 1512, x: 0, y: 0 };

describe("overlayMoveHides", () => {
  const corner = { height: 300, width: 448, x: 1064, y: 600 };

  it("hides a shown window growing from the corner to the whole display, where macOS drew the orb elsewhere", () => {
    expect(overlayMoveHides({ after: SCREEN, before: corner, visible: true })).toBe(true);
  });

  it("hides a shown window shrinking back to the corner", () => {
    expect(overlayMoveHides({ after: corner, before: SCREEN, visible: true })).toBe(true);
  });

  it("hides a corner that only changes height, the small jump", () => {
    expect(overlayMoveHides({ after: { ...corner, height: 320, y: 580 }, before: corner, visible: true })).toBe(true);
  });

  it("never hides a fit that leaves the bounds where they are", () => {
    expect(overlayMoveHides({ after: { ...corner }, before: corner, visible: true })).toBe(false);
  });

  it("never hides a window that is not on screen", () => {
    expect(overlayMoveHides({ after: SCREEN, before: corner, visible: false })).toBe(false);
  });
});

describe("overlayAreaWord", () => {
  const corner = { bounds: { height: 165, width: CORNER_WIDTH, x: 1064, y: 700 }, whole: false };

  it("echoes the asks of the extent the fit applied, with whether the window is whole", () => {
    expect(overlayAreaWord({ extent: { asks: 4, height: 140, wholeArea: false }, placement: corner })).toEqual({
      asks: 4,
      whole: false,
    });
  });

  it("echoes no asks before a page that reports has reported", () => {
    expect(overlayAreaWord({ extent: undefined, placement: { bounds: LAPTOP, whole: true } })).toEqual({
      asks: 0,
      whole: true,
    });
  });
});
