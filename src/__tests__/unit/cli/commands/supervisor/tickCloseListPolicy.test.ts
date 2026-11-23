import { describe, expect, it } from "vitest";

import { stagedListDecision } from "../../../../../cli/commands/supervisor/tickCloseListPolicy.js";

const BOUND = "a".repeat(64);
const OTHER = "b".repeat(64);
const ROUTE = " — restore that list to resume, or remove close-state.json to restart the close";

describe("stagedListDecision", () => {
  it("replaces whatever is staged while nothing committed, so an answered question leaves the owner's list", () => {
    expect(stagedListDecision({ recordedListSha256: undefined, stagedListSha256: OTHER })).toEqual({
      kind: "replace",
    });
    expect(stagedListDecision({ recordedListSha256: undefined, stagedListSha256: undefined })).toEqual({
      kind: "replace",
    });
  });

  it("reuses the staged list once a stage committed only while it hashes to the recorded digest", () => {
    expect(stagedListDecision({ recordedListSha256: BOUND, stagedListSha256: BOUND })).toEqual({
      kind: "reuse",
      listSha256: BOUND,
    });
  });

  it("refuses a staged list replaced since the close committed, naming both digests and the way back", () => {
    expect(stagedListDecision({ recordedListSha256: BOUND, stagedListSha256: OTHER })).toEqual({
      kind: "refuse",
      reason:
        "this close already committed a stage against the list with sha256 aaaaaaaaaaaa, and the list staged now " +
        `is bbbbbbbbbbbb${ROUTE}`,
    });
    expect(stagedListDecision({ recordedListSha256: OTHER, stagedListSha256: BOUND })).toEqual({
      kind: "refuse",
      reason:
        "this close already committed a stage against the list with sha256 bbbbbbbbbbbb, and the list staged now " +
        `is aaaaaaaaaaaa${ROUTE}`,
    });
  });

  it("refuses when the committed list is gone, rather than rendering a new one, and names the way back", () => {
    expect(stagedListDecision({ recordedListSha256: BOUND, stagedListSha256: undefined })).toEqual({
      kind: "refuse",
      reason: `this close already committed a stage against a list that is no longer staged${ROUTE}`,
    });
  });

  it("stages a fresh list for a close that committed on the seat's own list, which bound none", () => {
    expect(stagedListDecision({ recordedListSha256: null, stagedListSha256: undefined })).toEqual({ kind: "replace" });
    expect(stagedListDecision({ recordedListSha256: null, stagedListSha256: OTHER })).toEqual({ kind: "replace" });
  });
});
