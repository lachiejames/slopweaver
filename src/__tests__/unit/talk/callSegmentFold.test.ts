/*
 * Folding a call's speech lines into its stretches: the latest snapshot wins, a partial never undoes the final, and a
 * stretch began at the earliest instant any of its lines carries or names.
 */
import { describe, expect, it } from "vitest";

import type { CallEntry, CallSegment } from "../../../talk/callRecord.js";
import { foldSegment, notEarlier } from "../../../talk/callSegmentFold.js";

/** One segment line, overridable. */
const line = (
  over: Partial<Extract<CallEntry, { kind: "segment" }>> = {},
): Extract<CallEntry, { kind: "segment" }> => ({
  atIso: "2026-10-10T10:00:00.000Z",
  final: false,
  id: "s-1",
  kind: "segment",
  text: "look",
  who: "owner",
  ...over,
});

describe("notEarlier", () => {
  it("passes a line at or after the one held, never one before it", () => {
    expect([
      notEarlier({ held: "2026-10-10T10:00:00.000Z", next: "2026-10-10T10:00:00.000Z" }),
      notEarlier({ held: "2026-10-10T10:00:00.000Z", next: "2026-10-10T10:00:01.000Z" }),
      notEarlier({ held: "2026-10-10T10:00:01.000Z", next: "2026-10-10T10:00:00.000Z" }),
    ]).toEqual([true, true, false]);
  });
});

describe("foldSegment", () => {
  it("keeps the final over a late partial, and the earliest start any line carries or names", () => {
    const segments: CallSegment[] = [];
    foldSegment({
      entry: line({
        atIso: "2026-10-10T10:00:05.000Z",
        beganIso: "2026-10-10T10:00:00.000Z",
        final: true,
        text: "look at it",
      }),
      segments,
    });
    foldSegment({ entry: line({ atIso: "2026-10-10T10:00:02.000Z", text: "look at" }), segments });
    foldSegment({
      entry: line({ atIso: "2026-10-10T10:00:01.000Z", beganIso: "2026-10-10T10:00:09.000Z", text: "lo" }),
      segments,
    });
    expect(segments).toEqual([
      {
        atIso: "2026-10-10T10:00:05.000Z",
        beganIso: "2026-10-10T10:00:00.000Z",
        final: true,
        id: "s-1",
        open: undefined,
        text: "look at it",
        who: "owner",
      },
    ]);
  });
});
