/*
 * `taggedEventProblems` — what a `tagged` event's own shape must hold: it changes something, sets a one-valued key
 * at most once, and never sets and drops one key together. It moved here when `rowTags.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";

import { taggedEventProblems } from "../../../../handover/taggedEvent.js";

describe("taggedEventProblems", () => {
  it("is empty for a well-formed event", () => {
    expect(taggedEventProblems({ drop: ["audience"], set: [{ key: "platform", value: "slack" }] })).toEqual([]);
  });

  it("refuses an event that changes nothing", () => {
    expect(taggedEventProblems({ drop: [], set: [] })).toEqual(["a tagged event must set or drop at least one tag"]);
  });

  it("refuses a one-valued key set twice in one write", () => {
    expect(
      taggedEventProblems({
        drop: [],
        set: [
          { key: "impact", value: "high" },
          { key: "impact", value: "low" },
        ],
      }),
    ).toEqual(["impact holds one value, and this write sets it more than once"]);
  });

  it("allows a many-valued key set twice in one write", () => {
    expect(
      taggedEventProblems({
        drop: [],
        set: [
          { key: "workstream", value: "iso-certification" },
          { key: "workstream", value: "board" },
        ],
      }),
    ).toEqual([]);
  });

  it("refuses a key both set and dropped in one write", () => {
    expect(
      taggedEventProblems({ drop: ["workstream=board"], set: [{ key: "workstream", value: "iso-certification" }] }),
    ).toEqual(["one write both sets and drops workstream — drop it and set it in two writes"]);
  });
});
