/**
 * What a landing press's dry run says about our own walkthrough threads. The resolving itself is the child
 * `github enqueue`'s, and is tested beside it (`enqueueRun/walkthroughResolve.test.ts` and
 * `enqueueRun/walkthroughHold.test.ts`).
 */
import { describe, expect, it } from "vitest";

import { wouldClearClause } from "../../../../../cli/commands/github/landingThreads.js";

describe("wouldClearClause", () => {
  it("names how many threads a real press's enqueue would resolve first", () => {
    expect(wouldClearClause({ threadIds: ["PRRT_a", "PRRT_b"] })).toBe(
      "; its enqueue would first resolve 2 of our own open walkthrough thread(s)",
    );
  });

  it("says nothing at all when there are none", () => {
    expect(wouldClearClause({ threadIds: [] })).toBe("");
  });
});
