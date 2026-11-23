import { describe, expect, it } from "vitest";

import { controlsBlock, judgePoll } from "../../../../../cli/commands/desktop/e2eControlsCheck.js";

const VIEWPORT = { height: 980, width: 1512 };

/** The page as one read sees it: the fixture's probes, nothing over the clipped one, the whole-display window. */
const SEEN = {
  clipped: { x: 68, y: 2 },
  drawn: [
    { x: 68, y: 860 },
    { x: 180, y: 932 },
  ],
  probeOnControl: false,
  viewport: VIEWPORT,
};

/** The fixture's scroller as it is drawn, and the shoulder child over the second control's corner. */
const CARD = { height: 240, left: 8, top: 740, width: 120 };
const SHOULDER = { height: 16, left: 172, top: 924, width: 16 };
const ROW = { height: 40, left: 8, top: -20, width: 120 };

/** The page's third report since the fixture count, clipped as drawn. */
const CLIPPED = { sent: 3, value: { boxes: [CARD, SHOULDER], viewport: VIEWPORT } };

describe("judgePoll — one poll of the voice step's controls check", () => {
  it("judges a report measured in the probes' viewport off a page that held still", () => {
    expect(judgePoll({ again: SEEN, report: CLIPPED, reportAgain: CLIPPED, seen: SEEN })).toEqual({
      kind: "clipped",
    });
    const unclipped = { sent: 3, value: { boxes: [CARD, SHOULDER, ROW], viewport: VIEWPORT } };
    expect(judgePoll({ again: SEEN, report: unclipped, reportAgain: unclipped, seen: SEEN })).toEqual({
      kind: "unclipped",
      point: { x: 68, y: 2 },
    });
  });

  it("judges nothing when the page moved between its two reads", () => {
    const moved = { ...SEEN, viewport: { height: 400, width: 360 } };
    expect(judgePoll({ again: moved, report: CLIPPED, reportAgain: CLIPPED, seen: SEEN })).toBeUndefined();
  });

  it("judges nothing when the page sent another report before its second read was done", () => {
    const unclipped = { sent: 3, value: { boxes: [CARD, SHOULDER, ROW], viewport: VIEWPORT } };
    const newer = { sent: 4, value: CLIPPED.value };
    expect(judgePoll({ again: SEEN, report: unclipped, reportAgain: newer, seen: SEEN })).toBeUndefined();
    expect(judgePoll({ again: SEEN, report: undefined, reportAgain: newer, seen: SEEN })).toBeUndefined();
  });

  it("says a control sits over the clipped probe before reading any report", () => {
    const covered = { ...SEEN, probeOnControl: true };
    expect(judgePoll({ again: covered, report: CLIPPED, reportAgain: CLIPPED, seen: covered })).toEqual({
      kind: "probe-on-control",
    });
  });

  it("calls a missing report, or one from another viewport, unreported rather than wrong", () => {
    expect(judgePoll({ again: SEEN, report: undefined, reportAgain: undefined, seen: SEEN })).toEqual({
      kind: "unreported",
    });
    const corner = { sent: 1, value: { boxes: [CARD, SHOULDER], viewport: { height: 400, width: 360 } } };
    expect(judgePoll({ again: SEEN, report: corner, reportAgain: corner, seen: SEEN })).toEqual({
      kind: "unreported",
    });
  });
});

describe("controlsBlock — the step's answer from its last steady poll", () => {
  it("passes a clipped fixture", () => {
    expect(controlsBlock({ last: { kind: "clipped" } })).toBeUndefined();
  });

  it("names the point a wrong report got wrong", () => {
    expect(controlsBlock({ last: { kind: "unclipped", point: { x: 68, y: 2 } } })).toMatchObject({
      code: "CONTROLS_UNCLIPPED",
      x: 68,
      y: 2,
    });
    expect(controlsBlock({ last: { kind: "undrawn", point: { x: 180, y: 932 } } })).toMatchObject({
      code: "CONTROLS_UNDRAWN",
      x: 180,
      y: 932,
    });
  });

  it("blames neither the preload for a covered probe nor a report that never came", () => {
    expect(controlsBlock({ last: { kind: "probe-on-control" } })!.code).toBe("CONTROLS_PROBE_ON_CONTROL");
    expect(controlsBlock({ last: { kind: "unreported" } })).toMatchObject({ code: "CONTROLS_UNREPORTED", ms: 5000 });
  });
});
