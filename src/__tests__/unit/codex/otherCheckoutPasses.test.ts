/*
 * How many rows checkouts other than the caller's hold on a branch (`src/codex/otherCheckoutPasses.ts`). Pure: plain
 * records and receipts in, a count and the roots holding it out — counted through each checkout's own fold.
 */
import { describe, expect, it } from "vitest";

import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { otherCheckoutPassSummary } from "../../../codex/otherCheckoutPasses.js";
import type { Supersession } from "../../../codex/supersession.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { anyPassRecord, HEAD, planRecord, treeOn } from "./ledger/fixtures.js";

const BRANCH = "feature";
const SEAT = "/w/landing-seat";
const AUTHOR = "/w/author";
const OTHER = "/w/other";

const NO_RECEIPTS: FallbackReceiptScan = {
  foreign: 0,
  foreignModes: [],
  foreignReceipts: [],
  unboundReceipts: [],
  pending: 0,
  pendingPlans: 0,
  planReceipts: [],
  problems: [],
  receipts: [],
  unreadable: 0,
};
const NONE_RETIRED: ReadonlyMap<string, Supersession> = new Map();

/** A plan record taken in `repoRoot` on `branch`. */
function planIn({ repoRoot, branch = BRANCH }: { repoRoot: string; branch?: string }): CodexArtifactRecord {
  return { ...planRecord({ pass: "p2", tree: treeOn({ branch, headSha: HEAD, patch: "" }) }), repoRoot };
}

/** A BROKEN review record `pass` taken in `repoRoot` on the branch. */
function brokenIn({ repoRoot, pass }: { repoRoot: string; pass: "r1" | "r2" }): CodexArtifactRecord {
  const tree = treeOn({ branch: BRANCH, headSha: HEAD, patch: "" });
  return { ...anyPassRecord({ artifactId: `${repoRoot}-${pass}`, pass, tree, verdict: "BROKEN" }), repoRoot };
}

describe("otherCheckoutPassSummary", () => {
  it("counts the author's plan and both BROKEN reviews when the caller is a checkout that authored nothing", () => {
    const records = [
      planIn({ repoRoot: AUTHOR }),
      brokenIn({ pass: "r1", repoRoot: AUTHOR }),
      brokenIn({ pass: "r2", repoRoot: AUTHOR }),
    ];

    expect(
      otherCheckoutPassSummary({
        branch: BRANCH,
        fallbackScan: NO_RECEIPTS,
        ownRoot: SEAT,
        records,
        supersessions: NONE_RETIRED,
      }),
    ).toEqual({ passCount: 3, roots: [AUTHOR] });
  });

  it("never counts the caller's own rows, nor a checkout whose rows are on another branch", () => {
    const records = [
      planIn({ repoRoot: SEAT }),
      planIn({ branch: "unrelated", repoRoot: OTHER }),
      brokenIn({ pass: "r1", repoRoot: AUTHOR }),
    ];

    expect(
      otherCheckoutPassSummary({
        branch: BRANCH,
        fallbackScan: NO_RECEIPTS,
        ownRoot: SEAT,
        records,
        supersessions: NONE_RETIRED,
      }),
    ).toEqual({ passCount: 1, roots: [AUTHOR] });
  });

  it("names every other checkout holding rows, in candidate order, and sums their rows", () => {
    const records = [
      planIn({ repoRoot: OTHER }),
      planIn({ repoRoot: AUTHOR }),
      brokenIn({ pass: "r1", repoRoot: AUTHOR }),
    ];

    expect(
      otherCheckoutPassSummary({
        branch: BRANCH,
        fallbackScan: NO_RECEIPTS,
        ownRoot: SEAT,
        records,
        supersessions: NONE_RETIRED,
      }),
    ).toEqual({ passCount: 3, roots: [OTHER, AUTHOR] });
  });

  it("reports nothing when no record exists anywhere", () => {
    expect(
      otherCheckoutPassSummary({
        branch: BRANCH,
        fallbackScan: NO_RECEIPTS,
        ownRoot: SEAT,
        records: [],
        supersessions: NONE_RETIRED,
      }),
    ).toEqual({ passCount: 0, roots: [] });
  });
});
