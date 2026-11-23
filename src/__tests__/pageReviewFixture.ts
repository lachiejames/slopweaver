/*
 * Builders for the two records a `page publish --review` id resolves to — a Codex pass and a Claude fallback receipt
 * — plus the preparation they bind to. Every field the page-review code does not read is inert and fixed, so a test
 * names only the fields it is about.
 */
import type { ClaudeFallbackReviewReceipt } from "../codex/fallbackReview.js";
import type { CodexArtifactRecord, CodexPassScope } from "../codex/types.js";
import type { PageReviewEvidence, PageReviewPreparation } from "../pages/review.js";

const FIXTURE_BASE_SHA = "b".repeat(40);
export const FIXTURE_HEAD_SHA = "c".repeat(40);
export const FIXTURE_DIFF_SHA = "d".repeat(64);
export const FIXTURE_FRAGMENT_SHA = "f".repeat(64);
export const FIXTURE_REPO_ROOT = "/h/page-reviews/queue/prep-1/repo";
const FIXTURE_PROPERTY = { id: "page-answers-inputs", statement: "Every claim is in inputs/" };

/**
 * The preparation `page review-prepare` would have written for slug `queue`.
 *
 * @returns the preparation, with any field overridden
 */
export function fixturePreparation(over: Partial<PageReviewPreparation> = {}): PageReviewPreparation {
  return {
    baseSha: FIXTURE_BASE_SHA,
    createdAtIso: "2026-11-03T06:00:00.000Z",
    fragmentSha256: FIXTURE_FRAGMENT_SHA,
    headSha: FIXTURE_HEAD_SHA,
    preparationId: "prep-1",
    schemaVersion: 1,
    slug: "queue",
    ...over,
  };
}

/** The review scope a fixture pass carries unless a test passes its own. */
export const FIXTURE_REVIEW_SCOPE: Extract<CodexPassScope, { mode: "review" }> = {
  baseRef: FIXTURE_BASE_SHA,
  baseSha: FIXTURE_BASE_SHA,
  diffBytes: 120,
  diffSha256: FIXTURE_DIFF_SHA,
  headSha: FIXTURE_HEAD_SHA,
  mode: "review",
  pass: "r1",
  property: FIXTURE_PROPERTY,
};

/**
 * A conclusive Codex review pass over the fixture preparation.
 *
 * @returns the pass record, with its id, verdict, scope or outcome overridden
 */
export function fixtureCodexRecord({
  artifactId = "pass-1",
  verdict = "CLEAN",
  scope = FIXTURE_REVIEW_SCOPE,
  outcome = {
    answer: {
      counterexample: "",
      evidence: "read inputs/01-owner-words.md",
      propertyId: FIXTURE_PROPERTY.id,
      summary: "Every claim traces to the owner's words.",
      verdict,
    },
    kind: "answered",
    rawFinalResponse: "{}",
  },
}: {
  artifactId?: string;
  verdict?: "CLEAN" | "BROKEN";
  scope?: CodexPassScope;
  outcome?: CodexArtifactRecord["outcome"];
} = {}): CodexArtifactRecord {
  return {
    artifactId,
    attempts: [],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso: "2026-11-03T06:05:00.000Z",
    observedElapsedMs: 10,
    outcome,
    repoRoot: FIXTURE_REPO_ROOT,
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "xhigh",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope,
    tree: {
      branch: "main",
      dirtyBytes: 0,
      fingerprint: "e".repeat(64),
      headSha: FIXTURE_HEAD_SHA,
      treeSha: "a".repeat(40),
    },
  };
}

/**
 * A bound Claude fallback receipt over the fixture preparation.
 *
 * @returns the receipt, with its ids or verdict overridden
 */
export function fixtureFallbackReceipt({
  receiptId = "receipt-1",
  requestId = "request-1",
  verdict = "CLEAN",
}: {
  receiptId?: string;
  requestId?: string;
  verdict?: "CLEAN" | "BROKEN";
} = {}): ClaudeFallbackReviewReceipt {
  return {
    answer: {
      counterexample: "",
      evidence: "read inputs/01-owner-words.md",
      propertyId: FIXTURE_PROPERTY.id,
      summary: "Claude found every claim in the owner's words.",
      verdict,
    },
    completedAtIso: "2026-11-03T06:07:00.000Z",
    receiptId,
    request: {
      baseRef: FIXTURE_BASE_SHA,
      baseSha: FIXTURE_BASE_SHA,
      capEvidence: {
        blockedBy: "every destination capped",
        limitId: null,
        observedAtIso: "2026-11-03T05:59:00.000Z",
        reachedType: null,
      },
      createdAtIso: "2026-11-03T06:01:00.000Z",
      diffBytes: 120,
      diffSha256: FIXTURE_DIFF_SHA,
      headSha: FIXTURE_HEAD_SHA,
      pass: "r1",
      property: FIXTURE_PROPERTY,
      repoRoot: FIXTURE_REPO_ROOT,
      requestId,
      schemaVersion: 1,
      tree: {
        branch: "main",
        dirtyBytes: 0,
        fingerprint: "e".repeat(64),
        headSha: FIXTURE_HEAD_SHA,
        treeSha: "a".repeat(40),
      },
    },
    requestId,
    requestSha256: "9".repeat(64),
    reviewer: { host: "claude-code", model: null, workspace: null },
    schemaVersion: 1,
  };
}

/**
 * One review already proven to be about the fixture page.
 *
 * @returns the evidence, with any field overridden
 */
export function fixtureEvidence(over: Partial<PageReviewEvidence> = {}): PageReviewEvidence {
  return {
    completedAtIso: "2026-11-03T06:05:00.000Z",
    id: "pass-1",
    pass: "r1",
    preparationId: "prep-1",
    property: FIXTURE_PROPERTY,
    reviewedFragmentSha256: FIXTURE_FRAGMENT_SHA,
    reviewer: "codex",
    summary: "Every claim traces to the owner's words.",
    verdict: "CLEAN",
    ...over,
  };
}
