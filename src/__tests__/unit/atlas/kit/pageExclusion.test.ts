/**
 * Unit: an exclusion as the atlas page prints it carries the contract's own verdicts, never a re-judgement.
 */
import { describe, expect, it } from "vitest";

import { pageExclusion } from "../../../../atlas/kit/pageExclusion.js";

describe("pageExclusion", () => {
  it("marks an unfetched kind refused and withholding records", () => {
    expect(
      pageExclusion({ exclusion: { because: "private spaces", ground: "not-fetched", wouldBeClosedBy: "asking" } }),
    ).toStrictEqual({ because: "private spaces", ground: "not-fetched", refused: true, withholdsRecords: true });
  });

  it("marks a never-acted write neither refused nor withholding a record", () => {
    expect(pageExclusion({ exclusion: { because: "no writes", ground: "never-acted" } })).toStrictEqual({
      because: "no writes",
      ground: "never-acted",
      refused: false,
      withholdsRecords: false,
    });
  });
});
