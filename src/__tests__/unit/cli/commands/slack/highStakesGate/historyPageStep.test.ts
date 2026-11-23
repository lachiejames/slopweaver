/*
 * `historyPageStep`: one page of a channel's history is done, reads on with a cursor, or is truncated when Slack
 * says there is more but hands back no cursor.
 */
import { describe, expect, it } from "vitest";

import { historyPageStep } from "../../../../../../cli/commands/slack/highStakesRead.js";

describe("historyPageStep", () => {
  it("is done on a last page, reads on with a cursor, and is truncated with more and no cursor", () => {
    expect(historyPageStep({ hasMore: false, nextCursor: "abc" })).toEqual({ kind: "done" });
    expect(historyPageStep({ hasMore: undefined, nextCursor: undefined })).toEqual({ kind: "done" });
    expect(historyPageStep({ hasMore: true, nextCursor: "abc" })).toEqual({ cursor: "abc", kind: "next" });
    expect(historyPageStep({ hasMore: true, nextCursor: "" })).toEqual({ kind: "truncated" });
    expect(historyPageStep({ hasMore: true, nextCursor: undefined })).toEqual({ kind: "truncated" });
  });
});
