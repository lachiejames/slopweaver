/**
 * The review half of the pairing floor on its own: no review is a refusal, a CURRENT `BROKEN` before the second
 * review pass is a refusal naming the fix, and the same verdict after the second pass is a leftover instead.
 */
import { describe, expect, it } from "vitest";

import { reviewHalf } from "../../../codex/ledgerReviewHalf.js";
import { leftoverOf } from "../../../codex/reviewLeftovers.js";
import { ledgerRow } from "./ledgerEntryFixture.js";

describe("reviewHalf", () => {
  it("refuses a branch no review has read, and names no leftover", () => {
    const half = reviewHalf({ cap: undefined, entries: [] });

    expect(half.failures).toHaveLength(1);
    expect(half.failures[0]).toContain("no review pass has run on this branch");
    expect(half.leftovers).toEqual([]);
  });

  it("refuses a CURRENT BROKEN on the first pass, naming the second and last pass as the way through", () => {
    const half = reviewHalf({ cap: undefined, entries: [ledgerRow({ verdict: "BROKEN" })] });

    expect(half).toEqual({
      failures: [
        "r1 is CURRENT and BROKEN (r1-01) — fix it, then take the second and last review pass over the fixed diff",
      ],
      leftovers: [],
    });
  });

  it("turns a CURRENT BROKEN after the second pass into a leftover, refusing nothing", () => {
    const broken = ledgerRow({ artifactId: "art-2", diffSha256: "b", pass: "r2", verdict: "BROKEN" });
    const first = ledgerRow({ diffSha256: "a", freshness: { kind: "stale", reason: "the tree moved" } });

    expect(reviewHalf({ cap: undefined, entries: [broken, first] })).toEqual({
      failures: [],
      leftovers: [leftoverOf({ entry: broken })],
    });
  });

  it("passes a CURRENT CLEAN review with no failure and no leftover", () => {
    expect(reviewHalf({ cap: undefined, entries: [ledgerRow()] })).toEqual({ failures: [], leftovers: [] });
  });
});
