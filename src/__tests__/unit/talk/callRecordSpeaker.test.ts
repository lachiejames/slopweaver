/*
 * A call log's speaker label is the closed pair the console writes: the owner's, or the voice's. Anything else makes
 * the line unreadable rather than being guessed at.
 */
import { describe, expect, it } from "vitest";

import { type CallEntry, callEntryOf, OWNER_SPEAKER } from "../../../talk/callRecord.js";

/** A segment line, overridable. */
const said = (over: Partial<Record<keyof Extract<CallEntry, { kind: "segment" }>, unknown>> = {}): unknown => ({
  atIso: "2026-09-25T02:21:00.000Z",
  final: true,
  id: "s-1",
  kind: "segment",
  text: "look at the staging pool",
  who: "owner",
  ...over,
});

describe("callEntryOf", () => {
  it("writes the owner speaker label", () => {
    expect(OWNER_SPEAKER).toBe("owner");
  });

  it("reads a line under the owner's or the voice's label unchanged, and refuses a speaker it does not know", () => {
    expect([
      callEntryOf({ value: said() }),
      callEntryOf({ value: said({ who: "voice" }) }),
      callEntryOf({ value: said({ who: "chair" }) }),
    ]).toEqual([said(), said({ who: "voice" }), undefined]);
  });
});
