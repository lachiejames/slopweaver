/*
 * Where a mark leaves the reader: each call it read moves to its last line's frontier, a call it did not see
 * keeps its place, and a file with no whole line is left alone.
 */
import { describe, expect, it } from "vitest";

import { advancedCursor, type CallFrontier } from "../../../../talk/unreadWords.js";
import { CALL, FRONTIER, OTHER, said } from "./harness.js";

describe("advancedCursor", () => {
  it("moves each read call to its last line's frontier, keeps a call it did not see, and leaves a file with no whole line alone", () => {
    const kept: CallFrontier = { offset: 10, prefixSha256: "sha256:kept" };
    const moved: CallFrontier = { offset: 90, prefixSha256: "sha256:moved" };
    const cursor = advancedCursor({
      read: {
        bootstrapFloorIso: undefined,
        cursor: { calls: { [OTHER]: kept }, recordedAtIso: "2026-09-26T00:00:00.000Z" },
        quarantined: [],
        tails: [
          {
            callId: CALL,
            endedBefore: false,
            finalBefore: [],
            originBefore: undefined,
            relaysBefore: [],
            seenOriginBefore: new Map(),
            lines: [
              {
                after: FRONTIER,
                entry: said({ atIso: "2026-09-26T04:00:00.000Z", id: "s", text: "a" }),
                kind: "entry",
                sha256: "sha256:a",
              },
              {
                after: moved,
                kind: "unparseable",
                line: { byteOffset: 42, callId: CALL, text: "{" },
                sha256: "sha256:brace",
              },
            ],
            seenBefore: [],
            start: kept,
          },
          {
            callId: "a0000006-0000-4000-8000-000000000007",
            endedBefore: false,
            finalBefore: [],
            lines: [],
            originBefore: undefined,
            relaysBefore: [],
            seenOriginBefore: new Map(),
            seenBefore: [],
            start: undefined,
          },
        ],
      },
      recordedAtIso: "2026-09-26T05:00:00.000Z",
    });

    expect(cursor).toEqual({ calls: { [CALL]: moved, [OTHER]: kept }, recordedAtIso: "2026-09-26T05:00:00.000Z" });
  });
});
