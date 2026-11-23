import { describe, expect, it } from "vitest";

import { type E2eOrbDragSeen, orbDragBreaks } from "../../../desktop/e2eOrbDrag.js";

/**
 * Frame starts every `gap` milliseconds.
 *
 * @param count how many frames
 * @param gap the milliseconds between two
 * @returns the starts
 */
function steadyFrames({ count, gap }: { count: number; gap: number }): readonly number[] {
  return Array.from({ length: count }, (_unused, index) => index * gap);
}

/** A drag as the owner asked for it: sixty frames a second, one size, one re-fit, nothing moved, home again. */
const SMOOTH: E2eOrbDragSeen = {
  backAt: { x: 1464, y: 924 },
  frameTimes: steadyFrames({ count: 60, gap: 16.7 }),
  heldAt: { x: 110, y: 143 },
  keptBack: "default",
  releasedAt: { x: 110.4, y: 143 },
  restAt: { x: 1464, y: 924 },
  visibleWhileHeld: 0,
  widgetSizes: Array.from({ length: 60 }, () => "448x600"),
  windowBounds: ["1016,324,496,648", "32,33,1480,939", "32,33,1480,939"],
};

describe("orbDragBreaks", () => {
  it("finds nothing in a smooth drag that comes home", () => {
    expect(orbDragBreaks({ seen: SMOOTH })).toEqual([]);
  });

  it("names a drag at about five frames a second, as the owner saw it", () => {
    expect(orbDragBreaks({ seen: { ...SMOOTH, frameTimes: steadyFrames({ count: 12, gap: 200 }) } })).toEqual([
      "the drag drew about 5 frames a second (median frame 200ms, over 34ms)",
      "one frame of the drag took 200ms, over 150ms",
    ]);
  });

  it("names one long hitch in an otherwise smooth drag", () => {
    const frameTimes = [...steadyFrames({ count: 30, gap: 16 }), 30 * 16 + 400];
    expect(orbDragBreaks({ seen: { ...SMOOTH, frameTimes } })).toEqual([
      "one frame of the drag took 416ms, over 150ms",
    ]);
  });

  it("refuses to call a drag of too few frames smooth", () => {
    expect(orbDragBreaks({ seen: { ...SMOOTH, frameTimes: [0, 16, 32] } })).toEqual([
      "the drag drew 3 frame(s), too few to judge it smooth",
    ]);
  });

  it("names the widget resizing mid-drag as a flicker", () => {
    const widgetSizes = ["448x600", "448x600", "448x420", "448x600"];
    expect(orbDragBreaks({ seen: { ...SMOOTH, widgetSizes } })).toEqual([
      "the widget changed size 1 time(s) mid-drag (448x600 → 448x420), a flicker",
    ]);
  });

  it("names the window re-fitting more than once mid-drag", () => {
    const windowBounds = ["1016,324,496,648", "32,33,1480,939", "32,33,1480,832", "32,33,1480,939"];
    expect(orbDragBreaks({ seen: { ...SMOOTH, windowBounds } })).toEqual([
      "the window re-fit 2 times mid-drag, where once at its start is all it needs",
    ]);
  });

  it("names the card still drawn while the orb is held in the top left", () => {
    expect(orbDragBreaks({ seen: { ...SMOOTH, visibleWhileHeld: 1 } })).toEqual([
      "1 part(s) of the widget besides the orb stayed drawn while held in the top left, where the card is cut off past the window's edges",
    ]);
  });

  it("names a release that moves the orb", () => {
    expect(orbDragBreaks({ seen: { ...SMOOTH, releasedAt: { x: 110, y: 147 } } })).toEqual([
      "letting go moved the orb 4.0 points from where the drag showed it",
    ]);
  });

  it("names an orb that cannot come back down to where it rested", () => {
    expect(orbDragBreaks({ seen: { ...SMOOTH, backAt: { x: 1464, y: 817 }, keptBack: "at:48:48" } })).toEqual([
      "dragged back into the corner the orb rested 107.0 points from where it had always rested",
      'dragged back into the corner the page kept "at:48:48", not its default place',
    ]);
  });

  it("names a page that kept nothing at all", () => {
    expect(orbDragBreaks({ seen: { ...SMOOTH, keptBack: null } })).toEqual([
      "dragged back into the corner the page kept null, not its default place",
    ]);
  });
});
