/*
 * `totalPrunePlan`: each class counted and its footprint summed, an unmeasured footprint read as zero, the
 * detached class counted alongside the older ones, and an empty plan totalled to zeroes.
 */
import { describe, expect, it } from "vitest";

import { totalPrunePlan } from "../../../../worktree/pruneOptions.js";
import { classify } from "./harness.js";

describe("totalPrunePlan", () => {
  it("counts and sums each class, treating an unmeasured footprint as zero", () => {
    const totals = totalPrunePlan({
      verdicts: [
        classify(),
        classify({ diskKib: null, path: "/b" }),
        classify({ mergedIntoTrunk: false, path: "/c", unbackedCommits: 0 }),
        classify({ dirtyCount: 1, diskKib: 9, path: "/d" }),
      ],
    });
    expect(totals.counts).toEqual({
      detached: 0,
      gone: 0,
      hold: 1,
      interrupted: 0,
      merged: 2,
      pushed: 1,
      salvaged: 0,
      snapshot: 0,
    });
    expect(totals.reclaimableKib.merged).toBe(500_000);
    expect(totals.reclaimableKib.pushed).toBe(500_000);
    expect(totals.reclaimableKib.hold).toBe(9);
  });

  it("counts the detached class alongside the older ones", () => {
    const totals = totalPrunePlan({
      verdicts: [
        classify({
          branch: null,
          headOnRemoteRef: "origin/main",
          headSha: "9f1c2ab",
          mergedIntoTrunk: null,
          path: "/detached",
          unbackedCommits: 0,
        }),
      ],
    });
    expect(totals.counts.detached).toBe(1);
    expect(totals.reclaimableKib.detached).toBe(500_000);
  });

  it("totals an empty plan to zeroes rather than to nothing", () => {
    expect(totalPrunePlan({ verdicts: [] }).counts).toEqual({
      detached: 0,
      gone: 0,
      hold: 0,
      interrupted: 0,
      merged: 0,
      pushed: 0,
      salvaged: 0,
      snapshot: 0,
    });
  });
});
