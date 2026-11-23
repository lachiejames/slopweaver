/*
 * The enqueue door's review finding: an unapproved decision, an absent decision GitHub still holds a
 * code-owner request or a BLOCKED merge under, and the merge statuses that clear or keep a pending request.
 */
import { describe, expect, it } from "vitest";

import {
  enqueueFindings,
  unacknowledgedEnqueueFindings,
} from "../../../../../../cli/commands/github/enqueueFindings.js";
import { githubMergeStatus } from "../../../../../../review/githubMergeStatus.js";
import { BLOCKED, ORDINARY, PAIRED, pr } from "./fixtures.js";

describe("enqueueFindings", () => {
  it("raises review-not-approved and names who has approved so far", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ reviewDecision: "REVIEW_REQUIRED" }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("review-not-approved");
    expect(findings[0]!.detail).toContain("is REVIEW_REQUIRED");
    expect(findings[0]!.detail).toContain("approved so far by reviewer-one");
  });

  it("says nobody has approved when the approval list is empty", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ approvedBy: [], reviewDecision: "REVIEW_REQUIRED" }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings[0]!.detail).toContain("nobody has approved it");
  });

  it("raises nothing on review when the decision is absent and GitHub holds no code-owner request", () => {
    expect(
      enqueueFindings({
        target: ORDINARY,
        inspection: PAIRED,
        pr: pr({ codeownerRequests: [], reviewDecision: undefined }),
        requiredContexts: [],
        requiresCodeOwnerReviews: undefined,
      }),
    ).toEqual([]);
  });

  it("raises review-not-approved on the measured shape: no request, no decision, CI green, and GitHub BLOCKED", () => {
    // On acme/acme-admin, a ruleset-required review leaves reviewDecision null, and the
    // classic `requiresCodeOwnerReviews` setting cannot see it, so `false` there does not clear this.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ approvedBy: [], githubMergeStatus: BLOCKED, number: 18152, reviewDecision: undefined }),
      requiredContexts: ["build"],
      requiresCodeOwnerReviews: false,
    });
    expect(findings).toStrictEqual([
      {
        detail:
          "GitHub reports NO review decision on #18152 and holds no open code-owner request — nobody has approved " +
          "it — yet CI raised nothing and GitHub reports the merge BLOCKED, without saying by what. A review a " +
          "ruleset requires leaves the decision null, so this is not an approval.",
        kind: "review-not-approved",
        subject: "review-not-approved",
      },
    ]);
  });

  it("raises ONLY the CI finding over that shape while a required check is still running", () => {
    // GitHub reads BLOCKED while required checks run, and queueing then is the ordinary case — so the review
    // half stays silent rather than refusing every enqueue a session makes before its checks finish.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        approvedBy: [],
        checks: {
          baseRef: "main",
          checks: [{ kind: "check-run", name: "build", state: "running", url: undefined }],
          headSha: "cafe1234",
          mergeable: undefined,
          residue: [],
          rollupState: "PENDING",
          supersededChecks: [],
          truncated: false,
        },
        githubMergeStatus: BLOCKED,
        reviewDecision: undefined,
      }),
      requiredContexts: ["build"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.map((finding) => finding.subject)).toStrictEqual(["ci-not-green"]);
  });

  it("raises review-not-approved on that shape when the only red is advisory and CI raised nothing", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        approvedBy: [],
        checks: {
          baseRef: "staging",
          checks: [
            { kind: "check-run", name: "Required CI", state: "passed", url: undefined },
            { kind: "check-run", name: "Advisory local browser E2E (1)", state: "failed", url: undefined },
          ],
          headSha: "c35f9733",
          mergeable: undefined,
          residue: [],
          rollupState: "FAILURE",
          supersededChecks: [],
          truncated: false,
        },
        githubMergeStatus: BLOCKED,
        reviewDecision: undefined,
      }),
      requiredContexts: ["Required CI"],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.map((finding) => finding.subject)).toStrictEqual(["review-not-approved"]);
  });

  it("raises review-not-approved on an absent decision GitHub still holds a code-owner request under", () => {
    // The measured defect, on acme-admin: `reviewDecision: null` beside an open
    // `asCodeOwner: true` request out to a team, and the guard reported clean.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        githubMergeStatus: BLOCKED,
        reviewDecision: undefined,
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("review-not-approved");
    expect(findings[0]!.detail).toContain("acme/eng");
    expect(findings[0]!.detail).toContain("An absent decision is not an approval");
  });

  // The owner's ruling: an open request is GitHub having ASKED somebody, never the base
  // branch requiring them, and a pull request GitHub itself offers "Merge when ready" on is pressed.
  it.each(["CLEAN", "UNSTABLE", "HAS_HOOKS"])(
    "clears an asCodeOwner request the door's own read answers %s on, even where the branch wants owner review",
    (status) => {
      expect(
        enqueueFindings({
          target: ORDINARY,
          inspection: PAIRED,
          pr: pr({
            codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
            githubMergeStatus: githubMergeStatus({ value: status }),
            reviewDecision: undefined,
          }),
          requiredContexts: [],
          requiresCodeOwnerReviews: true,
        }),
      ).toEqual([]);
    },
  );

  it.each(["BEHIND", "DIRTY", "DRAFT", "UNKNOWN", "SOMETHING_NEW"])(
    "keeps review-not-approved when the door's own read answers %s, which settles nothing about review",
    (status) => {
      const findings = enqueueFindings({
        target: ORDINARY,
        inspection: PAIRED,
        pr: pr({
          codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
          githubMergeStatus: githubMergeStatus({ value: status }),
          reviewDecision: undefined,
        }),
        requiredContexts: [],
        requiresCodeOwnerReviews: true,
      });
      expect(findings.map((finding) => finding.subject)).toEqual(["review-not-approved"]);
    },
  );

  it("never lets a green merge status overrule a decision GitHub stated in words", () => {
    // The exception lives BELOW `reviewFinding`'s explicit-decision arm on purpose: an absent decision is
    // what it reads around, and CHANGES_REQUESTED is GitHub saying the opposite out loud.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        githubMergeStatus: githubMergeStatus({ value: "CLEAN" }),
        reviewDecision: "CHANGES_REQUESTED",
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: true,
    });
    expect(findings.map((finding) => finding.subject)).toEqual(["review-not-approved"]);
    expect(findings[0]!.detail).toContain("CHANGES_REQUESTED");
  });

  it("never clears a pending request off a TRUNCATED request read, however green the merge status", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        codeownerRequestsTruncated: true,
        githubMergeStatus: githubMergeStatus({ value: "CLEAN" }),
        reviewDecision: undefined,
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: true,
    });
    expect(findings.map((finding) => finding.subject)).toEqual(["review-not-approved"]);
    expect(findings[0]!.detail).toContain("can only ever LOSE an owner");
  });

  it("clears an asCodeOwner request when the base branch does NOT require code-owner review", () => {
    // GitHub creates a CODEOWNERS request whether or not the branch rule makes its approval mandatory, so
    // refusing on the request alone would hold back a pull request that can merge. Found adversarially.
    expect(
      enqueueFindings({
        target: ORDINARY,
        inspection: PAIRED,
        pr: pr({
          codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
          reviewDecision: undefined,
        }),
        requiredContexts: [],
        requiresCodeOwnerReviews: false,
      }),
    ).toEqual([]);
  });

  it("says the branch REQUIRES it when the protection read said so", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        githubMergeStatus: BLOCKED,
        reviewDecision: undefined,
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: true,
    });
    expect(findings[0]!.detail).toContain("main REQUIRES code-owner review");
  });

  it("does not rule the requirement out when the protection read could not answer", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
        githubMergeStatus: BLOCKED,
        reviewDecision: undefined,
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings[0]!.detail).toContain("could not be read, so this is not ruled out");
  });

  it("raises review-not-approved on an absent decision whose REQUEST read was capped", () => {
    // A capped request read loses a PENDING owner, so an empty list is not evidence of no requirement.
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({ codeownerRequests: [], codeownerRequestsTruncated: true, reviewDecision: undefined }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.subject).toBe("review-not-approved");
    expect(findings[0]!.detail).toContain("a PENDING code owner may be missing");
  });

  it("still raises nothing when the decision is APPROVED, whatever requests are still open", () => {
    expect(
      enqueueFindings({
        target: ORDINARY,
        inspection: PAIRED,
        pr: pr({
          codeownerRequests: [{ asCodeOwner: true, kind: "team", name: "acme/eng" }],
          reviewDecision: "APPROVED",
        }),
        requiredContexts: [],
        requiresCodeOwnerReviews: undefined,
      }),
    ).toEqual([]);
  });

  it("names an absent-decision code-owner finding under the SAME subject, so one acknowledgement covers it", () => {
    const findings = enqueueFindings({
      target: ORDINARY,
      inspection: PAIRED,
      pr: pr({
        codeownerRequests: [{ asCodeOwner: true, kind: "user", name: "a-colleague" }],
        reviewDecision: undefined,
      }),
      requiredContexts: [],
      requiresCodeOwnerReviews: undefined,
    });
    expect(
      unacknowledgedEnqueueFindings({ acknowledge: ["review-not-approved"], acknowledgeAll: false, findings }),
    ).toEqual([]);
  });
});
