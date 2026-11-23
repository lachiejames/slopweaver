/**
 * `slopweaver github enqueue`'s `review-not-approved` finding — every way GitHub can say review is not done.
 *
 * Split from `./enqueueFindings.ts` on size alone, along the seam the finding already had: everything here
 * reads `reviewDecision`, the code-owner request register and GitHub's merge status, and nothing else in
 * that module does. `./enqueueFindings.ts`'s `enqueueFindings` is still the one caller, and it supplies the
 * one CI fact this half needs.
 */

import type { MergeQueuePrState } from "../../../live/github/mergeQueue.js";
import {
  blockedWithoutReviewDecision,
  mergeStatusClause,
  pendingCodeownerRequestIsNonBlocking,
} from "../../../review/githubMergeStatus.js";
import type { EnqueueFinding } from "./enqueueFindings.js";

/**
 * The review finding, or none when nothing about review stands in the way.
 *
 * ## Why an ABSENT `reviewDecision` is never read as satisfied
 *
 * `reviewDecision` alone does not fold the CODEOWNERS requirement in, and `undefined` does not mean
 * "this base requires no review at all".
 * MEASURED on a pull request in `acme/acme-admin`: `reviewDecision: null` while GitHub simultaneously
 * held an open `asCodeOwner: true` review request out to a team, and the dry run printed *"clean: nothing
 * stands between this pull request and its base branch's merge queue"*. Across the owner's 29 open pull
 * requests there, this verb called 20 clean and exactly 3 were ready — 17 would have been queued over a
 * live code-owner ask, ten of them dependency bumps whose reviewers had been asked that morning.
 *
 * So an absent decision now falls back to GitHub's OWN code-owner answer: an open `asCodeOwner` request is
 * GitHub saying the rule is not satisfied yet, whatever its aggregate field reports. The finding is one
 * `review-not-approved` either way, because a caller acknowledging "review is not done" is making one
 * decision, not two.
 *
 * The fallback is CONSERVATIVE IN THE SAFE DIRECTION and that is deliberate: GitHub retires a code-owner
 * request the moment it clears, so a satisfied individual owner leaves nothing behind. This can therefore
 * hold a ready pull request back — never wave an unready one through.
 *
 * @internal called by `./enqueueFindings.ts` alone; its tests reach it through `enqueueFindings`.
 * @param branch the effective landing branch, named in the finding
 * @param pr the door's own read of the pull request
 * @param requiresCodeOwnerReviews whether classic branch protection ENFORCES codeowners, `undefined` unread
 * @param ciProvenGreen whether the CI and required-context findings both came back empty
 * @returns at most one `review-not-approved` finding
 */
export function reviewFinding({
  branch,
  pr,
  requiresCodeOwnerReviews,
  ciProvenGreen,
}: {
  branch: string;
  pr: MergeQueuePrState;
  requiresCodeOwnerReviews: boolean | undefined;
  ciProvenGreen: boolean;
}): readonly EnqueueFinding[] {
  if (pr.reviewDecision === "APPROVED") {
    return [];
  }
  const approvers =
    pr.approvedBy.length === 0 ? "nobody has approved it" : `approved so far by ${pr.approvedBy.join(", ")}`;
  // An EMPTY string is the same claim as an absent one — GitHub stated no decision. `parseMergeQueuePr`
  // normalises it away today, but the fleet read spells the same absence `""`, and a boundary where the two
  // evaluators disagree about one value is the drift the shared predicate exists to close.
  if (pr.reviewDecision === undefined || pr.reviewDecision.length === 0) {
    return absentDecisionFinding({ approvers, branch, ciProvenGreen, pr, requiresCodeOwnerReviews });
  }
  return [
    {
      detail:
        `GitHub's review decision on #${String(pr.number)} is ${pr.reviewDecision} — ${approvers}. ` +
        "The decision already includes whatever CODEOWNERS requires on this base.",
      kind: "review-not-approved",
      subject: "review-not-approved",
    },
  ];
}

/**
 * The finding when GitHub reports NO review decision, decided by its own open code-owner requests.
 *
 * No open request is not the same claim as "approved": it is "GitHub is not currently holding this pull
 * request for a code owner", which is the strongest thing this read can honestly say. So it raises nothing
 * unless GitHub ALSO reports the merge BLOCKED with CI raising nothing ({@link blockedUndecidedFinding}), and
 * the residue that a satisfied individual owner is invisible lives on the finding above rather than being
 * asserted here.
 *
 * ## The one exception, and why it sits exactly where it does
 *
 * An open `asCodeOwner` request says GitHub ASKED somebody, never that the base branch REQUIRES them. Owner
 * ruling: a pull request GitHub itself is offering
 * "Merge when ready" on is pressed, and a pending request is not what holds it. So where GitHub's own merge
 * status says it would merge this now ({@link pendingCodeownerRequestIsNonBlocking}), the request raises
 * nothing.
 *
 * Its position in this function is the whole of its blast radius, and every guard it sits BELOW stays:
 *
 * - An explicit `APPROVED`, `REVIEW_REQUIRED` or `CHANGES_REQUESTED` decision is handled by
 *   {@link reviewFinding} above and never reaches here, so a status of `CLEAN` can never overrule a
 *   decision GitHub stated in words.
 * - The TRUNCATION guard runs first. A capped request page loses a pending owner, so the register this is
 *   arguing about is not fully known, and relaxing incomplete evidence is a second policy change this is not.
 * - It is the door's OWN read of the status, never the fleet's (`../../../live/github/mergeQueue.ts`), so a
 *   fleet `CLEAN` followed by a door `BLOCKED` refuses. Nothing here acknowledges a finding on its own
 *   behalf; the provider mutation and its read-back stay the final authority.
 */
function absentDecisionFinding({
  pr,
  approvers,
  branch,
  requiresCodeOwnerReviews,
  ciProvenGreen,
}: {
  pr: MergeQueuePrState;
  approvers: string;
  branch: string;
  requiresCodeOwnerReviews: boolean | undefined;
  ciProvenGreen: boolean;
}): readonly EnqueueFinding[] {
  if (pr.codeownerRequestsTruncated) {
    return [
      {
        detail:
          `GitHub reports NO review decision on #${String(pr.number)}, and reported more review requests ` +
          "than this read carried — so a PENDING code owner may be missing from it. A capped request read " +
          "can only ever LOSE an owner, which turns an outstanding requirement into a clean verdict.",
        kind: "review-not-approved",
        subject: "review-not-approved",
      },
    ];
  }
  const pending = pr.codeownerRequests.map((request) => request.name).toSorted();
  if (pending.length === 0) {
    return blockedUndecidedFinding({ approvers, ciProvenGreen, pr });
  }
  if (requiresCodeOwnerReviews === false) {
    return [];
  }
  // The truncation guard above has already returned, so this field reads false here — it is passed rather
  // than written as a literal so that moving either guard cannot silently relax the other.
  const requestsTruncated = pr.codeownerRequestsTruncated;
  if (
    pendingCodeownerRequestIsNonBlocking({
      mergeStatus: pr.githubMergeStatus,
      requestsTruncated,
      reviewDecision: pr.reviewDecision,
    })
  ) {
    return [];
  }
  const setting =
    requiresCodeOwnerReviews === true
      ? `${branch} REQUIRES code-owner review`
      : `whether ${branch} requires code-owner review could not be read, so this is not ruled out`;
  return [
    {
      detail:
        `GitHub reports NO review decision on #${String(pr.number)}, but still holds an open code-owner ` +
        `review request out to ${pending.join(", ")} — ${approvers}. An absent decision is not an ` +
        `approval on a repository where the field reads null; GitHub's own \`asCodeOwner\` flag is. ${setting}, ` +
        `and ${mergeStatusClause({ mergeStatus: pr.githubMergeStatus })}.`,
      kind: "review-not-approved",
      subject: "review-not-approved",
    },
  ];
}

/**
 * The finding over an EMPTY request register when GitHub states no decision yet reports the merge BLOCKED.
 *
 * The door's half of `../../../review/landingTests.ts`'s rule, asking the same shared predicate so the read
 * that plans a press and the write that takes it cannot disagree. MEASURED on
 * a pull request in `acme/acme-admin`: BLOCKED, `reviewDecision: null`, no open request, nobody approved — a review a
 * ruleset requires, which leaves the decision null, and which `requiresCodeOwnerReviews` (classic branch
 * protection) cannot see, so that setting does not clear this. It fires only once CI raised no finding: a
 * running or red required check blocks the same way, and queueing while checks run is the ordinary case.
 */
function blockedUndecidedFinding({
  pr,
  approvers,
  ciProvenGreen,
}: {
  pr: MergeQueuePrState;
  approvers: string;
  ciProvenGreen: boolean;
}): readonly EnqueueFinding[] {
  if (
    !ciProvenGreen ||
    !blockedWithoutReviewDecision({ mergeStatus: pr.githubMergeStatus, reviewDecision: pr.reviewDecision })
  ) {
    return [];
  }
  return [
    {
      detail:
        `GitHub reports NO review decision on #${String(pr.number)} and holds no open code-owner request — ` +
        `${approvers} — yet CI raised nothing and ${mergeStatusClause({ mergeStatus: pr.githubMergeStatus })}. ` +
        "A review a ruleset requires leaves the decision null, so this is not an approval.",
      kind: "review-not-approved",
      subject: "review-not-approved",
    },
  ];
}
