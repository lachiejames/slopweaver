/*
 * The enqueue door's `review-not-approved` finding, called directly — `enqueueCore/findingsReview.test.ts` covers
 * it through `enqueueFindings`, where the CI fact it takes is computed rather than chosen. Here `ciProvenGreen`
 * is the input, so the empty-register, no-decision, BLOCKED arm is pinned on both sides of it.
 */
import { describe, expect, it } from "vitest";

import { reviewFinding } from "../../../../../cli/commands/github/enqueueReviewFinding.js";
import type { MergeQueuePrState } from "../../../../../live/github/mergeQueue.js";
import { githubMergeStatus } from "../../../../../review/githubMergeStatus.js";

/** A measured acme-admin pull request as re-read: BLOCKED, no decision, no request, nobody approved. */
const PR_18152: MergeQueuePrState = {
  approvedBy: [],
  baseRefName: "staging",
  baseRefOid: "ba5e0000",
  body: "",
  checks: {
    baseRef: "staging",
    checks: [],
    headSha: "cafe1234",
    mergeable: undefined,
    residue: [],
    rollupState: "SUCCESS",
    supersededChecks: [],
    truncated: false,
  },
  codeownerRequests: [],
  codeownerRequestsTruncated: false,
  entry: undefined,
  githubMergeStatus: githubMergeStatus({ value: "BLOCKED" }),
  headOid: "cafe1234",
  headRefName: "feature",
  isDraft: false,
  mergeable: "MERGEABLE",
  nodeId: "PR_kwabc",
  number: 18152,
  reviewDecision: undefined,
  stack: undefined,
  state: "OPEN",
  url: "https://github.com/acme/acme-admin/pull/18152",
};

describe("reviewFinding over an empty register and no decision", () => {
  it("raises review-not-approved on a BLOCKED merge once CI is proven green", () => {
    const findings = reviewFinding({
      branch: "staging",
      ciProvenGreen: true,
      pr: PR_18152,
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.map((finding) => finding.subject)).toStrictEqual(["review-not-approved"]);
  });

  it("raises nothing on the same BLOCKED merge while CI is not proven green", () => {
    expect(
      reviewFinding({ branch: "staging", ciProvenGreen: false, pr: PR_18152, requiresCodeOwnerReviews: undefined }),
    ).toStrictEqual([]);
  });

  it("raises nothing when GitHub reports CLEAN, which is a base requiring no review", () => {
    const clean = { ...PR_18152, githubMergeStatus: githubMergeStatus({ value: "CLEAN" }) };
    expect(
      reviewFinding({ branch: "staging", ciProvenGreen: true, pr: clean, requiresCodeOwnerReviews: undefined }),
    ).toStrictEqual([]);
  });
});
