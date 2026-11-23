import { describe, expect, it } from "vitest";

import {
  CASCADE_DX,
  CASCADE_DY,
  CASCADE_JS,
  CASCADE_MARGIN,
  CASCADE_NOMINAL_HEIGHT,
  cascadeSlot,
} from "../../../hand/note/cascade.js";
import { PANEL_WIDTH } from "../../../hand/note/panel.js";

/** The emitted `cascadeOrigin`, evaluated exactly as the panel program runs it. */
// oxlint-disable-next-line typescript/no-implied-eval -- the subject under test IS source text, as in panel.test.ts
const cascadeOrigin = new Function(`${CASCADE_JS}\nreturn cascadeOrigin;`)() as (...args: readonly unknown[]) => {
  x: number;
  y: number;
};

/** A 1512x944 visible frame, a 14-inch MacBook's below the menu bar. */
const FRAME = { height: 944, width: 1512, x: 0, y: 0 };
const WIDTH = 360;
const HEIGHT = 300;

describe("cascadeSlot — the slot a new note takes", () => {
  it("takes slot 0 when no note is up", () => {
    expect(cascadeSlot({ occupied: [] })).toBe(0);
  });

  it("never fills a gap under a live note, since the newer note in front would cover its title", () => {
    expect(cascadeSlot({ occupied: [0, 2, 3] })).toBe(4);
    expect(cascadeSlot({ occupied: [3] })).toBe(4);
  });

  it("stacks past every live note", () => {
    expect(cascadeSlot({ occupied: [1, 0, 2] })).toBe(3);
  });

  it("keeps its own step's slot when it replaces the note at the top of the stack", () => {
    expect(cascadeSlot({ occupied: [0, 1, 2], preferred: 2 })).toBe(2);
  });

  it("moves a replacement to the top when a live note sits past its own slot", () => {
    expect(cascadeSlot({ occupied: [0, 1, 2], preferred: 1 })).toBe(3);
  });

  it("ignores a preferred slot that is not a slot", () => {
    expect(cascadeSlot({ occupied: [0], preferred: 0.5 })).toBe(1);
  });
});

describe("cascadeOrigin — where each slot sits on screen", () => {
  it("puts slot 0 in the top-right corner, where the single note always sat", () => {
    expect(cascadeOrigin(0, FRAME, WIDTH, HEIGHT, false)).toEqual({
      x: FRAME.width - CASCADE_MARGIN - WIDTH,
      y: FRAME.height - CASCADE_MARGIN,
    });
  });

  it("steps each later slot left and down, so every older note's title stays showing above the newer one", () => {
    const zero = cascadeOrigin(0, FRAME, WIDTH, HEIGHT, false);
    const one = cascadeOrigin(1, FRAME, WIDTH, HEIGHT, false);
    const two = cascadeOrigin(2, FRAME, WIDTH, HEIGHT, false);
    expect([zero.x - one.x, zero.y - one.y, one.x - two.x, one.y - two.y]).toEqual([
      CASCADE_DX,
      CASCADE_DY,
      CASCADE_DX,
      CASCADE_DY,
    ]);
  });

  it("starts a new column back at the top once a nominal note would run off the bottom", () => {
    // (944 - 48 - 400) / 64 = 7.75, so seven steps after slot 0: eight slots in the first column.
    const perColumn = Math.floor((FRAME.height - CASCADE_MARGIN * 2 - CASCADE_NOMINAL_HEIGHT) / CASCADE_DY) + 1;
    const lastInColumn = cascadeOrigin(perColumn - 1, FRAME, WIDTH, CASCADE_NOMINAL_HEIGHT, false);
    const firstOfNext = cascadeOrigin(perColumn, FRAME, WIDTH, HEIGHT, false);
    const columnWidth = WIDTH + (perColumn - 1) * CASCADE_DX + CASCADE_MARGIN;
    expect([perColumn, lastInColumn.y - CASCADE_NOMINAL_HEIGHT >= CASCADE_MARGIN]).toEqual([8, true]);
    expect(firstOfNext).toEqual({
      x: FRAME.width - CASCADE_MARGIN - WIDTH - columnWidth,
      y: FRAME.height - CASCADE_MARGIN,
    });
  });

  it("counts one grid for every note whatever its height, so two neighbouring slots never share a place", () => {
    // r3's counterexample: an 800pt note in slot 2 and a 740pt one in slot 3 once read different columns.
    const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const xs = ({ height }: { height: number }): number[] =>
      slots.map((slot) => cascadeOrigin(slot, FRAME, WIDTH, height, false).x);
    expect(xs({ height: 120 })).toEqual(xs({ height: 800 }));
    const [two, three] = [cascadeOrigin(2, FRAME, WIDTH, 800, false), cascadeOrigin(3, FRAME, WIDTH, 740, false)];
    expect(two.x - three.x).toBe(CASCADE_DX);
  });

  it("lifts a note taller than the room below its place until its bottom is on screen", () => {
    const lastRow = cascadeOrigin(7, FRAME, WIDTH, 800, false);
    expect(lastRow.y).toBe(CASCADE_MARGIN + 800);
    expect(cascadeOrigin(7, FRAME, WIDTH, HEIGHT, false).y).toBe(FRAME.height - CASCADE_MARGIN - 7 * CASCADE_DY);
  });

  it("wraps to slot 0's place past the last column rather than drawing off screen", () => {
    const small = { height: 400, width: 500, x: 0, y: 0 };
    // One slot fits: 400 - 48 leaves no room past a 400pt nominal note, and 500 holds one 384-wide column.
    expect(cascadeOrigin(2, small, WIDTH, HEIGHT, false)).toEqual(cascadeOrigin(0, small, WIDTH, HEIGHT, false));
  });

  it("keeps one slot even when the note is taller than the frame", () => {
    const short = { height: 200, width: 1512, x: 0, y: 0 };
    expect(cascadeOrigin(1, short, WIDTH, HEIGHT, false).y).toBe(short.height - CASCADE_MARGIN);
  });

  it("runs the meeting-prep cascade from the top-left, down and right, clear of the ordinary first column", () => {
    const prep = [0, 1].map((slot) => cascadeOrigin(slot, FRAME, PANEL_WIDTH, HEIGHT, true));
    expect(prep).toEqual([
      { x: CASCADE_MARGIN, y: FRAME.height - CASCADE_MARGIN },
      { x: CASCADE_MARGIN + CASCADE_DX, y: FRAME.height - CASCADE_MARGIN - CASCADE_DY },
    ]);
    // Each first column, eight slots deep on this frame, right edge against left edge: they never meet.
    const prepRight = cascadeOrigin(7, FRAME, PANEL_WIDTH, HEIGHT, true).x + PANEL_WIDTH;
    const ordinaryLeft = cascadeOrigin(7, FRAME, PANEL_WIDTH, HEIGHT, false).x;
    expect(prepRight).toBeLessThan(ordinaryLeft);
  });

  it("offsets from the visible frame's own origin, so a second display places notes on itself", () => {
    const right = { height: 944, width: 1512, x: 1512, y: 100 };
    expect(cascadeOrigin(0, right, WIDTH, HEIGHT, false)).toEqual({
      x: right.x + right.width - CASCADE_MARGIN - WIDTH,
      y: right.y + right.height - CASCADE_MARGIN,
    });
  });
});
