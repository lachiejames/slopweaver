/**
 * `slopweaver github review-state`, question 4 — who ownership requires, who has approved, and what is owed.
 *
 * Pure, and split out of `./reviewStateReport.ts` along the one seam a row has three inputs that must agree on:
 * the CODEOWNERS rules, the reviews and GitHub's own outstanding code-owner requests. A reader chasing a wrong
 * OWNERS cell lands on all three here.
 */

import type { PrLiveState } from "../../../live/github/reviewState.js";
import { approvedTeamsOf, type CodeownerReviewState, codeownerReviewState } from "../../../review/codeownerRules.js";
import { type CodeownersRule, requiredOwners } from "../../../review/codeowners.js";
import { type GithubCodeownerRequirement, githubCodeownerRequirement } from "../../../review/githubCodeowners.js";
import { approvingLogins, type RequiredApprover, requiredApprovers } from "../../../review/reviewState.js";

/** One repository's CODEOWNERS, or the fact that it declares none. */
export interface RepoCodeowners {
  readonly rules: readonly CodeownersRule[];
  /** Where the file was found, or the empty string when the repository has none. */
  readonly path: string;
}

/** Why a pull request's approver list may be incomplete. */
function approverResidue({
  pr,
  codeowners,
}: {
  pr: PrLiveState;
  codeowners: RepoCodeowners | undefined;
}): readonly string[] {
  const residue: string[] = [];
  if (codeowners === undefined || codeowners.path === "") {
    residue.push(`${pr.repoSlug} declares no CODEOWNERS, so no approver is required by ownership`);
  }
  if (pr.changedPathsTruncated) {
    residue.push("more files changed than --file-limit requested; the owner list may be missing a rule");
  }
  return residue;
}

/** What the codeowner answer itself could not establish, said out loud rather than folded into a verdict. */
function codeownerResidue({ codeowners }: { codeowners: CodeownerReviewState }): readonly string[] {
  if (codeowners.verdict === "satisfied" || codeowners.verdict === "none") {
    return [];
  }
  return [
    "whether this repository ENFORCES its CODEOWNERS is a branch-protection setting this read does not fetch, " +
      "so an owed rule is what GitHub's own review requirement would ask for rather than proof it will refuse a merge",
  ];
}

/**
 * Question 4, whole: the rule-derived answer, GitHub's own code-owner answer, and what neither could establish.
 *
 * @param pr the live pull-request state
 * @param codeowners that repository's rules, or undefined when it declares none
 * @returns the required owners, the logins whose approval currently stands, the per-rule answer, GitHub's
 *   own requirement and the residue sentences
 */
export function ownershipAnswer({ pr, codeowners }: { pr: PrLiveState; codeowners: RepoCodeowners | undefined }): {
  readonly approvers: readonly RequiredApprover[];
  readonly approvedBy: ReadonlySet<string>;
  readonly owners: CodeownerReviewState;
  readonly github: GithubCodeownerRequirement;
  readonly residue: readonly string[];
} {
  const rules = codeowners === undefined ? [] : codeowners.rules;
  const approvedBy = approvingLogins({ authorLogin: pr.authorLogin, reviews: pr.reviews });
  const owners = codeownerReviewState({
    approvedLogins: approvedBy,
    approvedTeams: approvedTeamsOf({ approvedLogins: approvedBy, reviews: pr.reviews }),
    authorLogin: pr.authorLogin,
    changedPaths: pr.changedPaths,
    requestedReviewers: pr.requestedReviewers,
    rules,
  });
  return {
    approvedBy,
    approvers: requiredApprovers({
      authorLogin: pr.authorLogin,
      owners: requiredOwners({ paths: pr.changedPaths, rules }),
    }),
    github: githubCodeownerRequirement({
      requests: pr.codeownerRequests,
      requestsTruncated: pr.codeownerRequestsTruncated,
      reviews: pr.reviews,
      reviewsTruncated: pr.reviewsTruncated,
    }),
    owners,
    residue: [...approverResidue({ codeowners, pr }), ...codeownerResidue({ codeowners: owners })],
  };
}
