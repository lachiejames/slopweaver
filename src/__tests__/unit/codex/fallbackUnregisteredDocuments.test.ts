/**
 * Fallback documents on the `codex-provider-unregistered` ground, through the REAL store-backed port over an
 * in-memory store, the ledger fold and the rule-9 floor every landing reader shares.
 *
 * The properties: a request on this ground reads back as its own kind and only its own kind, never as a
 * foreign or unreadable row (either would mislead the landing gate); the rows it folds into never witness a cap;
 * and the floor clears a STALE READY plan plus a CURRENT CLEAN review on this ground exactly as it does on a
 * cap — with a post-hoc plan and a BROKEN review each its falsifier.
 */
import { describe, expect, it } from "vitest";

import {
  type ClaudeFallbackPlanReceipt,
  type ClaudeFallbackPlanRequest,
  fallbackLedgerEntries,
  validateFallbackPlan,
} from "../../../codex/fallbackPlan.js";
import { isFallbackPlanDocument } from "../../../codex/fallbackPlanGround.js";
import { fallbackRequestText, storedPlanRequest, storedReviewRequest } from "../../../codex/fallbackRequestRead.js";
import {
  type ClaudeFallbackReviewReceipt,
  type ClaudeFallbackReviewRequest,
  validateFallbackReview,
} from "../../../codex/fallbackReview.js";
import { type TreeFingerprint, treeFingerprint } from "../../../codex/fingerprint.js";
import { ledgerForBranch, loopFailures } from "../../../codex/ledger.js";
import { cappedPlanNextStep } from "../../../codex/ledgerCapClauses.js";
import {
  CODEX_UNREGISTERED_PLAN_MODE,
  CODEX_UNREGISTERED_REVIEW_MODE,
  CODEX_UNREGISTERED_WHY,
} from "../../../codex/providerUnregistered.js";
import type { CodexPassTree } from "../../../codex/types.js";
import { unwrap } from "../../../lib/result.js";
import { memoryFallbackRegisterPort, memoryFallbackStore } from "../../fallbackRegisterFixture.js";

const HOME = "/h/unused-by-the-memory-store";
const REPO = "/w/repo";
const BRANCH = "feature";
const PLAN_HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const WORK_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";
const GROUND = {
  kind: "codex-provider-unregistered",
  observedAtIso: "2026-11-05T01:00:00.000Z",
  why: CODEX_UNREGISTERED_WHY,
} as const;
const SESSION = { host: "claude-code", model: "opus", workspace: null } as const;

function fingerprintOn({ headSha }: { headSha: string }): TreeFingerprint {
  return treeFingerprint({ dirtyPatch: "", headSha, treeSha: `${headSha.slice(2)}ab` });
}

function treeOn({ headSha }: { headSha: string }): CodexPassTree {
  const fp = fingerprintOn({ headSha });
  return { branch: BRANCH, dirtyBytes: fp.dirtyBytes, fingerprint: fp.digest, headSha, treeSha: fp.treeSha };
}

const PLAN_NOW = fingerprintOn({ headSha: PLAN_HEAD });
const WORK_NOW = fingerprintOn({ headSha: WORK_HEAD });

function planRequest({ headSha = PLAN_HEAD }: { headSha?: string } = {}): ClaudeFallbackPlanRequest {
  return {
    createdAtIso: "2026-11-05T01:00:00.000Z",
    ground: GROUND,
    mode: CODEX_UNREGISTERED_PLAN_MODE,
    pass: "p2",
    promptBytes: 1,
    promptSha256: "a".repeat(64),
    repoRoot: REPO,
    requestId: "plan-u",
    schemaVersion: 1,
    taskSha256: "b".repeat(64),
    tree: treeOn({ headSha }),
  };
}

function reviewRequest(): ClaudeFallbackReviewRequest {
  return {
    baseRef: "origin/main",
    baseSha: PLAN_HEAD,
    createdAtIso: "2026-11-05T02:00:00.000Z",
    diffBytes: 10,
    diffSha256: "d".repeat(64),
    ground: GROUND,
    headSha: WORK_HEAD,
    mode: CODEX_UNREGISTERED_REVIEW_MODE,
    pass: "r1",
    property: { id: "r1-01", statement: "the unregistered ground never reads as a cap" },
    repoRoot: REPO,
    requestId: "rev-u",
    schemaVersion: 1,
    tree: treeOn({ headSha: WORK_HEAD }),
  };
}

function planReceipt({ headSha = PLAN_HEAD }: { headSha?: string } = {}): ClaudeFallbackPlanReceipt {
  const request = planRequest({ headSha });
  return unwrap(
    validateFallbackPlan({
      answer: JSON.stringify({ blockers: [], bodyMarkdown: "## Plan", summary: "ready", verdict: "READY" }),
      completedAtIso: "2026-11-05T01:05:00.000Z",
      now: fingerprintOn({ headSha }),
      planner: SESSION,
      receiptId: "plan-rcpt-u",
      request,
      requestBytes: fallbackRequestText({ request }),
    }),
  );
}

function reviewReceipt({ verdict }: { verdict: "CLEAN" | "BROKEN" }): ClaudeFallbackReviewReceipt {
  const request = reviewRequest();
  return unwrap(
    validateFallbackReview({
      answer: JSON.stringify({
        counterexample: verdict === "BROKEN" ? "a cap clause printed for a Claude-only install" : "",
        evidence: "e",
        propertyId: "r1-01",
        summary: "s",
        verdict,
      }),
      completedAtIso: "2026-11-05T02:05:00.000Z",
      now: WORK_NOW,
      receiptId: "rev-rcpt-u",
      request,
      requestBytes: fallbackRequestText({ request }),
      reviewer: SESSION,
    }),
  );
}

function entriesFor({
  planReceipts,
  receipts,
}: {
  planReceipts: readonly ClaudeFallbackPlanReceipt[];
  receipts: readonly ClaudeFallbackReviewReceipt[];
}): ReturnType<typeof ledgerForBranch>["entries"] {
  return ledgerForBranch({
    branch: BRANCH,
    fallbackEntries: fallbackLedgerEntries({
      branch: BRANCH,
      now: WORK_NOW,
      repoRoot: REPO,
      scan: { planReceipts, receipts },
    }),
    now: WORK_NOW,
    records: [],
    repoRoot: REPO,
  }).entries;
}

describe("the new modes are their own kinds, never a legacy one", () => {
  it("names neither mode with a string an older build already parses", () => {
    const legacy = new Set(["plan", "review", "review-policy-refusal"]);

    expect(legacy.has(CODEX_UNREGISTERED_PLAN_MODE)).toBe(false);
    expect(legacy.has(CODEX_UNREGISTERED_REVIEW_MODE)).toBe(false);
  });

  it("reads the unregistered plan mode as a plan document and the review mode as not one", () => {
    expect(isFallbackPlanDocument({ value: { mode: CODEX_UNREGISTERED_PLAN_MODE, schemaVersion: 1 } })).toBe(true);
    expect(isFallbackPlanDocument({ value: { mode: CODEX_UNREGISTERED_REVIEW_MODE, schemaVersion: 1 } })).toBe(false);
  });
});

describe("the store reads each request back as its own kind", () => {
  it("scans an unregistered review request as a pending review, neither foreign nor unreadable", async () => {
    const port = memoryFallbackRegisterPort({ store: memoryFallbackStore() });
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "rev-u",
        requestText: fallbackRequestText({ request: reviewRequest() }),
      }),
    );

    expect(unwrap(await port.scan({ home: HOME }))).toMatchObject({
      foreign: 0,
      pending: 1,
      pendingPlans: 0,
      unreadable: 0,
    });
    const stored = unwrap(await port.readRequest({ home: HOME, requestId: "rev-u" }));
    expect(unwrap(storedReviewRequest({ stored })).request).toEqual(reviewRequest());
    expect(storedPlanRequest({ stored })._unsafeUnwrapErr().message).toBe(
      "fallback request rev-u is a review request, not a plan one",
    );
  });

  it("scans an unregistered plan request as a pending plan, and refuses it as a review", async () => {
    const port = memoryFallbackRegisterPort({ store: memoryFallbackStore() });
    unwrap(
      await port.writeRequest({
        home: HOME,
        requestId: "plan-u",
        requestText: fallbackRequestText({ request: planRequest() }),
      }),
    );

    expect(unwrap(await port.scan({ home: HOME }))).toMatchObject({
      foreign: 0,
      pending: 0,
      pendingPlans: 1,
      unreadable: 0,
    });
    const stored = unwrap(await port.readRequest({ home: HOME, requestId: "plan-u" }));
    expect(unwrap(storedPlanRequest({ stored })).request).toEqual(planRequest());
    expect(storedReviewRequest({ stored })._unsafeUnwrapErr().message).toBe(
      "fallback request plan-u is a plan request, not a review one",
    );
  });
});

describe("the rows this ground folds into", () => {
  it("carries the ground and an outcome naming it, never a cap", () => {
    const entries = entriesFor({ planReceipts: [planReceipt()], receipts: [reviewReceipt({ verdict: "CLEAN" })] });

    expect(entries.map((entry) => entry.fallbackGround)).toEqual([
      "codex-provider-unregistered",
      "codex-provider-unregistered",
    ]);
    expect(entries.map((entry) => entry.outcomeContext)).toEqual([
      `Claude fallback review — No Codex plan is registered: ${CODEX_UNREGISTERED_WHY}`,
      `Claude fallback plan — No Codex plan is registered: ${CODEX_UNREGISTERED_WHY}`,
    ]);
  });

  it("prints no cap clause when the newest row stands on it and the live gate reads no cap", () => {
    const entries = entriesFor({ planReceipts: [], receipts: [reviewReceipt({ verdict: "CLEAN" })] });

    expect(cappedPlanNextStep({ cap: undefined, entries })).toBe("");
  });
});

describe("the rule-9 floor over this ground", () => {
  it("clears a STALE READY plan plus a CURRENT CLEAN review", () => {
    expect(
      loopFailures({
        entries: entriesFor({ planReceipts: [planReceipt()], receipts: [reviewReceipt({ verdict: "CLEAN" })] }),
      }),
    ).toEqual([]);
  });

  it("refuses a plan recorded over the tree being landed — CURRENT is post-hoc", () => {
    const failures = loopFailures({
      entries: entriesFor({
        planReceipts: [planReceipt({ headSha: WORK_HEAD })],
        receipts: [reviewReceipt({ verdict: "CLEAN" })],
      }),
    });

    expect(failures.length).toBe(1);
  });

  it("refuses a CURRENT BROKEN review", () => {
    const failures = loopFailures({
      entries: entriesFor({ planReceipts: [planReceipt()], receipts: [reviewReceipt({ verdict: "BROKEN" })] }),
    });

    expect(failures.length).toBe(1);
  });
});

// PLAN_NOW is the tree the plan was prepared over; asserting it differs from the landing tree is what makes the
// STALE case above stale rather than a coincidence of equal fingerprints.
describe("the fixture's two trees", () => {
  it("are distinct", () => {
    expect(PLAN_NOW.digest === WORK_NOW.digest).toBe(false);
  });
});
