/*
 * Which candidate checkouts can change a landing verdict for one branch (`src/codex/branchEvidenceRoots.ts`).
 * Pure: plain records and receipts in, two ordered halves out.
 */
import { describe, expect, it } from "vitest";

import { partitionCandidateRoots } from "../../../codex/branchEvidenceRoots.js";
import { candidateRepoRoots } from "../../../codex/candidateRepoRoots.js";
import type { FallbackReceiptScan } from "../../../codex/fallbackDocuments.js";
import { type ClaudeFallbackPlanRequest, validateFallbackPlan } from "../../../codex/fallbackPlan.js";
import { treeFingerprint } from "../../../codex/fingerprint.js";
import type { CodexArtifactRecord } from "../../../codex/types.js";
import { unwrap } from "../../../lib/result.js";
import { HEAD, planRecord, treeOn } from "./ledger/fixtures.js";

const BRANCH = "feature";
const OWN = "/w/own";
const A = "/w/a";
const B = "/w/b";
const C = "/w/c";
const D = "/w/d";
const CANDIDATES = [OWN, A, B, C, D] as const;

/** A pass record taken in `repoRoot` on `branch` (`null` for a detached HEAD), or with no tree at all. */
function recordIn({ repoRoot, branch }: { repoRoot: string; branch: string | null | "no-tree" }): CodexArtifactRecord {
  if (branch === "no-tree") {
    return { ...planRecord({ pass: "p2", tree: undefined }), repoRoot };
  }
  return { ...planRecord({ pass: "p2", tree: treeOn({ branch, headSha: HEAD, patch: "" }) }), repoRoot };
}

/** An empty receipt scan, which a case extends with the receipts it is about. */
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

/** A bound Claude fallback plan receipt prepared in `repoRoot` on `branch`. */
function planReceiptIn({
  repoRoot,
  branch,
}: {
  repoRoot: string;
  branch: string;
}): FallbackReceiptScan["planReceipts"][number] {
  const request: ClaudeFallbackPlanRequest = {
    capEvidence: {
      blockedBy: "Codex reported workspace_member_usage_limit_reached at 2026-09-15T08:22:23.654Z",
      limitId: null,
      observedAtIso: "2026-09-15T08:22:23.654Z",
      reachedType: "workspace_member_usage_limit_reached",
    },
    createdAtIso: "2026-09-15T16:00:00.000Z",
    mode: "plan",
    pass: "p2",
    promptBytes: 900,
    promptSha256: "a".repeat(64),
    repoRoot,
    requestId: `plan-req-${repoRoot}`,
    schemaVersion: 1,
    taskSha256: "b".repeat(64),
    tree: treeOn({ branch, headSha: HEAD, patch: "" }),
  };
  return unwrap(
    validateFallbackPlan({
      answer: JSON.stringify({ blockers: [], bodyMarkdown: "## Plan", summary: "ready", verdict: "READY" }),
      completedAtIso: "2026-09-15T16:05:00.000Z",
      now: treeFingerprint({ dirtyPatch: "", headSha: HEAD, treeSha: `${HEAD.slice(2)}ab` }),
      planner: { host: "claude-code", model: "opus", workspace: "workspace:1" },
      receiptId: `plan-rcpt-${repoRoot}`,
      request,
      requestBytes: JSON.stringify(request),
    }),
  );
}

describe("candidateRepoRoots", () => {
  it("lists the own checkout first, then every root records and receipts name, each once, in first-seen order", () => {
    expect(
      candidateRepoRoots({
        fallbackScan: {
          ...NO_RECEIPTS,
          foreignReceipts: [{ branch: "other", mode: "future-mode", repoRoot: C, requestId: "f-1" }],
          planReceipts: [planReceiptIn({ branch: "other", repoRoot: B })],
          unboundReceipts: [{ branch: BRANCH, problem: "prompt digest moved", repoRoot: D, requestId: "u-1" }],
        },
        ownRoot: OWN,
        records: [recordIn({ branch: "other", repoRoot: A }), recordIn({ branch: BRANCH, repoRoot: OWN })],
      }),
    ).toEqual([OWN, A, B, C, D]);
  });

  it("drops a record root that is not a non-empty string, and lists no own checkout when there is none", () => {
    const nullRoot = { ...recordIn({ branch: BRANCH, repoRoot: A }) };
    Reflect.set(nullRoot, "repoRoot", null);
    expect(
      candidateRepoRoots({
        fallbackScan: NO_RECEIPTS,
        ownRoot: undefined,
        records: [nullRoot, recordIn({ branch: BRANCH, repoRoot: "" }), recordIn({ branch: BRANCH, repoRoot: B })],
      }),
    ).toEqual([B]);
  });
});

describe("partitionCandidateRoots", () => {
  it("keeps the own checkout relevant with nothing naming it, and nothing else", () => {
    expect(
      partitionCandidateRoots({
        branch: BRANCH,
        candidates: CANDIDATES,
        fallbackScan: NO_RECEIPTS,
        ownRoot: OWN,
        records: [],
      }),
    ).toEqual({ relevant: [OWN], remaining: [A, B, C, D] });
  });

  it("names a checkout by a pass record on the branch, and never by one on another branch, detached or tree-less", () => {
    expect(
      partitionCandidateRoots({
        branch: BRANCH,
        candidates: CANDIDATES,
        fallbackScan: undefined,
        ownRoot: undefined,
        records: [
          recordIn({ branch: "other", repoRoot: A }),
          recordIn({ branch: BRANCH, repoRoot: C }),
          recordIn({ branch: null, repoRoot: B }),
          recordIn({ branch: "no-tree", repoRoot: D }),
        ],
      }),
    ).toEqual({ relevant: [C], remaining: [OWN, A, B, D] });
  });

  it("names a checkout by a plan receipt or a foreign receipt on the branch, not by one on another branch", () => {
    expect(
      partitionCandidateRoots({
        branch: BRANCH,
        candidates: CANDIDATES,
        fallbackScan: {
          ...NO_RECEIPTS,
          foreignReceipts: [
            { branch: BRANCH, mode: "future-mode", repoRoot: D, requestId: "f-1" },
            { branch: "other", mode: "future-mode", repoRoot: B, requestId: "f-2" },
          ],
          planReceipts: [
            planReceiptIn({ branch: BRANCH, repoRoot: A }),
            planReceiptIn({ branch: "other", repoRoot: C }),
          ],
        },
        ownRoot: OWN,
        records: [],
      }),
    ).toEqual({ relevant: [OWN, A, D], remaining: [B, C] });
  });

  it("ignores receipts when the read folds none", () => {
    expect(
      partitionCandidateRoots({
        branch: BRANCH,
        candidates: CANDIDATES,
        fallbackScan: undefined,
        ownRoot: OWN,
        records: [],
      }),
    ).toEqual({ relevant: [OWN], remaining: [A, B, C, D] });
  });

  it("adds no root evidence names outside the candidates, and keeps the candidates' own order", () => {
    expect(
      partitionCandidateRoots({
        branch: BRANCH,
        candidates: [D, B, A],
        fallbackScan: undefined,
        ownRoot: "/w/not-a-candidate",
        records: [
          recordIn({ branch: BRANCH, repoRoot: "/w/elsewhere" }),
          recordIn({ branch: BRANCH, repoRoot: A }),
          recordIn({ branch: BRANCH, repoRoot: D }),
        ],
      }),
    ).toEqual({ relevant: [D, A], remaining: [B] });
  });

  it("never names a checkout by a pass record whose root is not a non-empty string", () => {
    // The record parser never validates `repoRoot`, so a `null` from disk arrives typed as a string — forged here.
    const nullRoot = { ...recordIn({ branch: BRANCH, repoRoot: A }) };
    Reflect.set(nullRoot, "repoRoot", null);
    expect(
      partitionCandidateRoots({
        branch: BRANCH,
        candidates: ["", A],
        fallbackScan: undefined,
        ownRoot: undefined,
        records: [nullRoot, recordIn({ branch: BRANCH, repoRoot: "" })],
      }),
    ).toEqual({ relevant: [], remaining: ["", A] });
  });
});
