import { describe, expect, it } from "vitest";

import { controlsVerdict, type E2eControlsProbes } from "../../../desktop/e2eControls.js";

const PROBES: E2eControlsProbes = {
  clipped: { x: 68, y: 2 },
  drawn: [
    { x: 68, y: 860 },
    { x: 180, y: 932 },
  ],
};

/** The fixture's scroller as it is drawn, and the shoulder child over the second control's corner. */
const CARD = { height: 240, left: 8, top: 740, width: 120 };
const SHOULDER = { height: 16, left: 172, top: 924, width: 16 };

describe("controlsVerdict — the voice step's check that reported controls are clipped as drawn", () => {
  it("passes a report covering what the fixture draws and nothing above its scroller", () => {
    expect(controlsVerdict({ boxes: [CARD, SHOULDER], probes: PROBES })).toEqual({ kind: "clipped" });
  });

  it("fails a report carrying a row scrolled out of view where it sits in layout", () => {
    const row = { height: 40, left: 8, top: -20, width: 120 };
    expect(controlsVerdict({ boxes: [CARD, SHOULDER, row], probes: PROBES })).toEqual({
      kind: "unclipped",
      point: { x: 68, y: 2 },
    });
  });

  it("fails the cap's union of every leftover row, which reaches the top of the window", () => {
    const union = { height: 3200, left: 8, top: -2460, width: 120 };
    expect(controlsVerdict({ boxes: [CARD, SHOULDER, union], probes: PROBES }).kind).toBe("unclipped");
  });

  it("says a drawn point is uncovered before judging the clipped one, an empty report included", () => {
    expect(controlsVerdict({ boxes: [], probes: PROBES })).toEqual({ kind: "undrawn", point: { x: 68, y: 860 } });
    expect(controlsVerdict({ boxes: [CARD], probes: PROBES })).toEqual({
      kind: "undrawn",
      point: { x: 180, y: 932 },
    });
  });

  it("counts a box's left and top edges as inside it and its right and bottom edges as outside", () => {
    const edges: E2eControlsProbes = { clipped: { x: 20, y: 10 }, drawn: [{ x: 10, y: 10 }] };
    expect(controlsVerdict({ boxes: [{ height: 10, left: 10, top: 10, width: 10 }], probes: edges })).toEqual({
      kind: "clipped",
    });
  });
});
