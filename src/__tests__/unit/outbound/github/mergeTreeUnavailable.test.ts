/**
 * `mergeTreeUnavailable` — why a merged tree could not be had. A `git merge-tree` stopped at its bound used to
 * read as a conflict, sending a reader to resolve a merge that was clean.
 */
import { describe, expect, it } from "vitest";

import { mergeTreeUnavailable } from "../../../../outbound/github/probeSweep.js";

describe("mergeTreeUnavailable", () => {
  it("names a merge stopped at its two-minute bound, and never calls it a conflict", () => {
    const why = mergeTreeUnavailable({ baseRef: "main", headRef: "feat", merged: { kind: "timed-out" } });
    expect(why).toBe('git merge-tree of "main" and "feat" was still running after 2 minutes, so it was stopped');
  });

  it("keeps the conflict clause as it read before", () => {
    const why = mergeTreeUnavailable({ baseRef: "main", headRef: "feat", merged: { kind: "conflict" } });
    expect(why).toBe('"main" and "feat" do not merge cleanly');
  });
});
