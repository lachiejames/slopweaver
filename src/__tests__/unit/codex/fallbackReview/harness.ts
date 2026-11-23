/*
 * What the Claude fallback review test files share: one checkout, branch and pair of HEADs, the tree fingerprint a
 * request stores, a cap-grounded request and the CLEAN receipt validated over it, the refusal-grounded request, and
 * the review floor read through a ledger holding Codex records beside fallback receipts.
 */
import {
  type ClaudeFallbackReviewReceipt,
  type ClaudeFallbackReviewRequest,
  fallbackReviewEntries,
  validateFallbackReview,
} from "../../../../codex/fallbackReview.js";
import { type TreeFingerprint, treeFingerprint } from "../../../../codex/fingerprint.js";
import { ledgerForBranch, loopFailures } from "../../../../codex/ledger.js";
import { POLICY_REFUSAL_REVIEW_MODE } from "../../../../codex/policyFallback.js";
import type { CodexArtifactRecord, CodexPassTree, PlanPassId } from "../../../../codex/types.js";
import { unwrap } from "../../../../lib/result.js";

export const REPO = "/w/repo";
export const BRANCH = "feature";
export const HEAD = "06e12d9aa1b2c3d4e5f60718293a4b5c6d7e8f90";
export const OTHER_HEAD = "2148718aa1b2c3d4e5f60718293a4b5c6d7e8f90";

/**
 * A tree fingerprint plus the loose parts a request stores, so the two always agree in a fixture.
 *
 * @returns the fingerprint of that HEAD with that dirty patch
 */
export function fingerprintOn({ headSha, patch }: { headSha: string; patch: string }): TreeFingerprint {
  return treeFingerprint({ dirtyPatch: patch, headSha, treeSha: `${headSha.slice(2)}ab` });
}

/**
 * The pass tree a record or request stores for that branch, HEAD and dirty patch.
 *
 * @returns a tree whose fingerprint fields agree with `fingerprintOn` over the same HEAD and patch
 */
function treeOn({ branch, headSha, patch }: { branch: string | null; headSha: string; patch: string }): CodexPassTree {
  const fp = fingerprintOn({ headSha, patch });
  return { branch, dirtyBytes: fp.dirtyBytes, fingerprint: fp.digest, headSha, treeSha: fp.treeSha };
}

export { treeOn };

export const CLEAN_TREE = treeOn({ branch: BRANCH, headSha: HEAD, patch: "" });
export const CLEAN_NOW = fingerprintOn({ headSha: HEAD, patch: "" });

/** The cap-grounded arm — every request before the refusal ground, and what these tests build. */
type CapRequest = Extract<ClaudeFallbackReviewRequest, { readonly capEvidence: unknown }>;

/**
 * A cap-grounded r2 request prepared on the clean tree, with any field overridden.
 *
 * @returns the request, `over` spread last
 */
export function request(over: Partial<CapRequest> = {}): CapRequest {
  return {
    baseRef: "origin/main",
    baseSha: OTHER_HEAD,
    capEvidence: {
      blockedBy: "Codex reported workspace_member_usage_limit_reached at 2026-09-13T14:49:01.803Z",
      limitId: "premium",
      observedAtIso: "2026-09-13T14:49:01.803Z",
      reachedType: "workspace_member_usage_limit_reached",
    },
    createdAtIso: "2026-09-14T01:00:00.000Z",
    diffBytes: 120,
    diffSha256: "d".repeat(64),
    headSha: HEAD,
    pass: "r2",
    property: { id: "r2-01", statement: "no receipt satisfies the floor over a moved tree" },
    repoRoot: REPO,
    requestId: "req-1",
    schemaVersion: 1,
    tree: CLEAN_TREE,
    ...over,
  };
}

export const CLEAN_ANSWER = JSON.stringify({
  counterexample: "",
  evidence: "read the packet",
  propertyId: "r2-01",
  summary: "holds",
  verdict: "CLEAN",
});

export const REVIEWER = { host: "claude-code", model: "opus", workspace: "workspace:7" } as const;

/**
 * The receipt `validateFallbackReview` records for that request and answer, read on that tree.
 *
 * @returns the validated receipt, unwrapped so a refusal throws
 */
export function receiptFor({
  req = request(),
  answer = CLEAN_ANSWER,
  now = CLEAN_NOW,
}: {
  req?: ClaudeFallbackReviewRequest;
  answer?: string;
  now?: TreeFingerprint;
} = {}): ClaudeFallbackReviewReceipt {
  return unwrap(
    validateFallbackReview({
      answer,
      completedAtIso: "2026-09-14T01:30:00.000Z",
      now,
      receiptId: "rcpt-1",
      request: req,
      requestBytes: JSON.stringify(req),
      reviewer: REVIEWER,
    }),
  );
}

/* ---------- the floor, with a receipt in the ledger ---------- */

/**
 * A READY Codex planning record for that pass over that tree.
 *
 * @returns the answered plan record
 */
export function planRecord({
  pass,
  tree,
  createdAtIso = "2026-09-13T00:00:00.000Z",
}: {
  pass: PlanPassId;
  tree: CodexPassTree;
  createdAtIso?: string;
}): CodexArtifactRecord {
  return {
    artifactId: `plan-${pass}`,
    attempts: [],
    bound: { conclusionWindowMs: 150, totalMs: 1000, warnAfterMs: 850 },
    createdAtIso,
    observedElapsedMs: 10,
    outcome: {
      answer: { blockers: [], bodyMarkdown: "", summary: "", verdict: "READY" },
      kind: "answered",
      rawFinalResponse: "{}",
    },
    repoRoot: REPO,
    requestedApprovalPolicy: "never",
    requestedModel: "m",
    requestedNetworkAccess: true,
    requestedReasoningEffort: "medium",
    requestedSandboxMode: "workspace-write",
    requestedWebSearch: true,
    requestedWritableRoots: [],
    schemaVersion: 1,
    scope: { mode: "plan", pass, promptBytes: 1, promptSha256: "p" },
    tree,
  };
}

/** The plan floor's own requirement: a STALE READY plan — read on an OLDER tree. */
export const STALE_PLAN = planRecord({ pass: "p2", tree: treeOn({ branch: BRANCH, headSha: OTHER_HEAD, patch: "" }) });

/**
 * The loop floor's failures for this branch, read from those Codex records beside those fallback receipts.
 *
 * @returns each failure line the floor reports, empty when it clears
 */
export function floor({
  records,
  receipts,
  now = CLEAN_NOW,
}: {
  records: readonly CodexArtifactRecord[];
  receipts: readonly ClaudeFallbackReviewReceipt[];
  now?: TreeFingerprint;
}): readonly string[] {
  const ledger = ledgerForBranch({
    branch: BRANCH,
    fallbackEntries: fallbackReviewEntries({ branch: BRANCH, now, receipts, repoRoot: REPO }),
    now,
    records,
    repoRoot: REPO,
  });
  return loopFailures({ entries: ledger.entries });
}

/* ---------- the refusal ground: Codex refused this review on policy twice ---------- */

const REFUSAL_GROUND = {
  artifactId: "codex-r3-refused",
  initialFinishedAtIso: "2026-09-23T06:01:00.000Z",
  kind: "cyber-policy",
  retryFinishedAtIso: "2026-09-23T06:03:00.000Z",
} as const;

/**
 * A request on the refusal ground — the cap arm's fields, with `mode` and `ground` in place of `capEvidence`.
 *
 * @returns the refusal-grounded request
 */
export function refusalRequest(): ClaudeFallbackReviewRequest {
  const { capEvidence: _capEvidence, ...core } = request();
  return { ...core, ground: REFUSAL_GROUND, mode: POLICY_REFUSAL_REVIEW_MODE };
}
