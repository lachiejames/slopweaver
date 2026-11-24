/**
 * The review half of the pairing floor on its own: no review is a refusal, a CURRENT `BROKEN` before the second
 * review pass is a refusal naming the fix, and the same verdict after the second pass is a leftover instead. A
 * baseline-bump witness row is the other lane: it neither satisfies nor refuses this half.
 */
import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "../../../codex/ledger.js";
import { reviewHalf } from "../../../codex/ledgerReviewHalf.js";
import { leftoverOf } from "../../../codex/reviewLeftovers.js";
import { ledgerRow } from "./ledgerEntryFixture.js";

const DIGEST = "c".repeat(64);

/** A current Codex r3 witness row for a synthetic bump digest, over diff `w`. */
const witness = (over: Partial<LedgerEntry> = {}): LedgerEntry =>
  ledgerRow({
    artifactId: "witness-1",
    diffSha256: "w",
    pass: "r3",
    propertyId: `baseline-bump-${DIGEST}`,
    propertyStatement: `Ratchet bump ${DIGEST}: each loosening listed is JUSTIFIED`,
    ...over,
  });

describe("reviewHalf", () => {
  it("refuses a branch no review has read, and names no leftover", () => {
    const half = reviewHalf({ cap: undefined, entries: [] });

    expect(half.failures).toHaveLength(1);
    expect(half.failures[0]).toContain("no general review pass has run on this branch");
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

describe("reviewHalf beside a baseline-bump witness", () => {
  it("does not let a CURRENT CLEAN witness alone stand in for a general review", () => {
    const half = reviewHalf({ cap: undefined, entries: [witness()] });

    expect(half.failures).toHaveLength(1);
    expect(half.failures[0]).toContain("no general review pass has run on this branch");
    expect(half.leftovers).toEqual([]);
  });

  it("passes a CURRENT CLEAN general review with a CLEAN witness beside it", () => {
    expect(reviewHalf({ cap: undefined, entries: [witness(), ledgerRow()] })).toEqual({
      failures: [],
      leftovers: [],
    });
  });

  it("makes a CURRENT BROKEN witness neither a pairing failure nor a leftover", () => {
    expect(reviewHalf({ cap: undefined, entries: [witness({ verdict: "BROKEN" }), ledgerRow()] })).toEqual({
      failures: [],
      leftovers: [],
    });
  });

  it("keeps a general BROKEN on its first pass a refusal however many witness diffs stand", () => {
    const entries = [
      witness({ artifactId: "witness-2", diffSha256: "w2" }),
      witness(),
      ledgerRow({ verdict: "BROKEN" }),
    ];

    expect(reviewHalf({ cap: undefined, entries })).toEqual({
      failures: [
        "r1 is CURRENT and BROKEN (r1-01) — fix it, then take the second and last review pass over the fixed diff",
      ],
      leftovers: [],
    });
  });

  it("reads a witness-looking row whose statement is not a witness claim as a general review", () => {
    const broad = witness({ propertyStatement: "every function in this diff is correct", verdict: "BROKEN" });

    expect(reviewHalf({ cap: undefined, entries: [broad] })).toEqual({
      failures: [
        `r3 is CURRENT and BROKEN (baseline-bump-${DIGEST}) — fix it, then take the second and last review pass ` +
          "over the fixed diff",
      ],
      leftovers: [],
    });
  });
});
