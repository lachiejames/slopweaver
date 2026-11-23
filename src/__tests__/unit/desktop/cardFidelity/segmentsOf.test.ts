/*
 * `segmentsOf`: each segment keeps its last final text and earliest start, a never-finished one keeps its last words,
 * and an empty one is dropped.
 */
import { describe, expect, it } from "vitest";

import { segmentsOf } from "../../../../desktop/cardFidelitySegments.js";
import type { CallEntry } from "../../../../talk/callRecord.js";
import { at } from "./harness.js";

describe("segmentsOf", () => {
  it("keeps each segment's last final text and earliest start, a never-finished one's last words, and drops an empty one", () => {
    const entries: CallEntry[] = [
      {
        atIso: at({ seconds: 5 }),
        beganIso: at({ seconds: 1 }),
        final: false,
        id: "v1",
        kind: "segment",
        text: "The ca",
        who: "voice",
      },
      { atIso: at({ seconds: 6 }), final: true, id: "v1", kind: "segment", text: "The card asks.", who: "voice" },
      { atIso: at({ seconds: 3 }), final: false, id: "v2", kind: "segment", text: "dropped mid", who: "voice" },
      { atIso: at({ seconds: 4 }), final: true, id: "h1", kind: "segment", text: "  ", who: "owner" },
    ];
    expect(segmentsOf({ lines: entries })).toEqual([
      { firstLine: 0, id: "v1", startMs: Date.parse(at({ seconds: 1 })), text: "The card asks.", who: "voice" },
      { firstLine: 2, id: "v2", startMs: Date.parse(at({ seconds: 3 })), text: "dropped mid", who: "voice" },
    ]);
  });
});
