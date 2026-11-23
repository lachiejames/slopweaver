import { describe, expect, it } from "vitest";

import { judgeHunk } from "../../../../live/github/diffOnBaseHunk.js";
import type { Hunk } from "../../../../live/github/diffOnBaseLines.js";

/** A one-line replacement of `old` by `new` between two context lines, at line two of the file. */
const REPLACE: Hunk = {
  newStart: 1,
  oldStart: 1,
  post: ["a", "new", "c"],
  pre: ["a", "old", "c"],
  removed: ["old"],
};

describe("judgeHunk", () => {
  it("places a landed post-image where it sits on the base", () => {
    const answer = judgeHunk({ base: ["x", "a", "new", "c"], head: ["a", "new", "c"], hunk: REPLACE });
    expect(answer).toEqual({ at: { end: 4, start: 1 }, verdict: "on-base" });
  });

  it("says a hunk whose pre-image still stands and post-image is nowhere is still to land", () => {
    const answer = judgeHunk({ base: ["a", "old", "c"], head: ["a", "new", "c"], hunk: REPLACE });
    expect(answer).toEqual({ verdict: "not-on-base" });
  });

  it("refuses a landed post-image when a line it deletes survives elsewhere on the base", () => {
    const answer = judgeHunk({ base: ["a", "new", "c", "old"], head: ["a", "new", "c"], hunk: REPLACE });
    expect(answer).toEqual({ reason: "a line it deletes is still in the file", verdict: "unknown" });
  });

  it("refuses a patch whose post-image is not where its header puts it in the head's own copy", () => {
    const answer = judgeHunk({ base: ["a", "new", "c"], head: ["y", "a", "new", "c"], hunk: REPLACE });
    expect(answer.reason).toBe("GitHub's patch does not place the change where the pull request's own copy has it");
  });

  it("calls a context-free insertion unknown, since it names no place to check", () => {
    const insertion: Hunk = { newStart: 1, oldStart: 0, post: ["new"], pre: [], removed: [] };
    const answer = judgeHunk({ base: ["new"], head: ["new"], hunk: insertion });
    expect(answer).toEqual({
      reason: "it inserts lines with no surrounding lines to place them by",
      verdict: "unknown",
    });
  });
});
