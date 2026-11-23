/**
 * What CodeRabbit has SAID about one pull request, as one verdict.
 *
 * Split out of `./reviewState.ts` to stay under the 300-code-line cap. It is a real seam
 * rather than a slice for the number: this asks one reviewer BOT what it concluded and whether its last word
 * still stands on the current head, and nothing else in that file reads a review body at all.
 */

import { CODERABBIT_LOGIN, type CodeRabbitVerdict, type ReviewFacts, type ThreadFacts } from "./reviewState.js";

/** The last review whose state is an OPINION — GitHub's own word for approved or changes-requested. */
function lastOpinionated({ reviews }: { reviews: readonly ReviewFacts[] }): ReviewFacts | undefined {
  return reviews.findLast((review) => review.state === "APPROVED" || review.state === "CHANGES_REQUESTED");
}

/**
 * What is holding a standing CodeRabbit CHANGES_REQUESTED once no CURRENT thread of its own is open.
 *
 * CodeRabbit withdraws that verdict only when EVERY one of its conversations is resolved, outdated ones
 * included: resolving all of them triggers a CI check that takes about 10 seconds, after which CodeRabbit
 * flips. An outdated thread no longer
 * counts against an approval already on the head, which is why {@link codeRabbitVerdict} skips it before it
 * reaches here — but on this arm it is the reason the verdict stands. MEASURED on a real
 * pull request in `acme/acme-admin`: the sentence read only "latest verdict is CHANGES_REQUESTED" while two outdated
 * CodeRabbit threads were open. Reproduce with
 * `slopweaver github review-state --repo acme/acme-admin --number 17322 --detail`.
 *
 * Every thread resolved and the verdict still standing is `stuck`, its own verdict rather than a sentence,
 * because a WRITE branches on it: the owner's ruling has `github landing --press` re-request the review
 * (`./codeRabbitNudge.ts`). Zero CodeRabbit threads is not `stuck` — nothing was resolved, so a finding in
 * the review BODY is the likelier holder. Nor is a head CodeRabbit has not reviewed yet: after a push its own
 * review of the new head is still to come, and re-requesting it then would be a duplicate of the one in flight.
 *
 * @param ownThreads every thread CodeRabbit opened
 * @param newestOid the commit CodeRabbit's newest review names, of any state, or the empty string when none
 * @param headOid the pull request's current head, or the empty string when it could not be read
 * @param reviewsTruncated whether the review list came back short, which could hide the approval that flipped it
 * @returns the verdict and the sentence naming what to resolve, or that the flip is still to land
 */
function changesRequestedVerdict({
  ownThreads,
  newestOid,
  headOid,
  reviewsTruncated,
}: {
  ownThreads: readonly ThreadFacts[];
  newestOid: string;
  headOid: string;
  reviewsTruncated: boolean;
}): {
  readonly verdict: CodeRabbitVerdict;
  readonly detail: string;
} {
  const outdatedOpen = ownThreads.filter((thread) => !thread.isResolved).length;
  if (outdatedOpen > 0) {
    return {
      detail: `CodeRabbit's CHANGES_REQUESTED is held by ${String(outdatedOpen)} unresolved outdated CodeRabbit comment(s)`,
      verdict: "changes-requested",
    };
  }
  if (ownThreads.length > 0 && reviewsTruncated) {
    return {
      detail:
        "every CodeRabbit comment is resolved and its CHANGES_REQUESTED has not flipped, but this read could not " +
        "see every review, so a newer one may already have flipped it",
      verdict: "changes-requested",
    };
  }
  if (ownThreads.length > 0 && (newestOid === "" || headOid === "")) {
    return {
      detail:
        "every CodeRabbit comment is resolved and its CHANGES_REQUESTED has not flipped, but this read cannot tie " +
        "CodeRabbit's last review to the current head",
      verdict: "changes-requested",
    };
  }
  if (ownThreads.length > 0 && newestOid !== headOid) {
    return {
      detail:
        `every CodeRabbit comment is resolved and CodeRabbit last reviewed ${newestOid.slice(0, 7)} — its review ` +
        `of the head ${headOid.slice(0, 7)} is still to come`,
      verdict: "changes-requested",
    };
  }
  if (ownThreads.length > 0) {
    return {
      detail:
        "every CodeRabbit comment is resolved and its CHANGES_REQUESTED has not flipped — `github landing --press` " +
        "re-requests its review twenty seconds after the read that saw it",
      verdict: "stuck",
    };
  }
  return { detail: "CodeRabbit's latest verdict is CHANGES_REQUESTED", verdict: "changes-requested" };
}

/**
 * Whether CodeRabbit's standing approval is of the CURRENT head — green only when both commits are known
 * and equal.
 *
 * The newest review standing on the head is not enough: a COMMENTED re-review of a new push leaves an
 * APPROVED of an EARLIER commit as the last opinion, and an approval GitHub attached to no commit names no
 * head at all. Either way "approved the current head" would be a claim this read did not make.
 *
 * @param approvedOid the commit CodeRabbit's last approval names, or the empty string when it names none
 * @param headOid the pull request's current head, or the empty string when it could not be read
 * @returns the verdict and the sentence naming what decided it
 */
function approvalVerdict({ approvedOid, headOid }: { approvedOid: string; headOid: string }): {
  readonly verdict: CodeRabbitVerdict;
  readonly detail: string;
} {
  if (approvedOid === "" || headOid === "") {
    return {
      detail: "CodeRabbit approved, but this read cannot tie that approval to the current head",
      verdict: "unknown",
    };
  }
  if (approvedOid !== headOid) {
    return {
      detail: `CodeRabbit approved ${approvedOid.slice(0, 7)}, not the current head ${headOid.slice(0, 7)}`,
      verdict: "stale",
    };
  }
  return { detail: "CodeRabbit approved the current head with nothing outstanding", verdict: "green" };
}

/**
 * Question 2 — is CodeRabbit all green.
 *
 * Six things are checked. The third is the one a board usually misses: CodeRabbit approving an EARLIER
 * push leaves an `APPROVED` review sitting on a pull request whose head has moved on, which reads as green
 * from every angle except the commit the review names.
 *
 * @param reviews every review on the pull request, oldest first
 * @param threads every review thread, attributed to whoever opened it
 * @param headOid the pull request's current head commit, or the empty string when it could not be read
 * @param reviewsTruncated whether the review list came back short of every review — never `stuck` then
 * @returns the verdict and a sentence naming what decided it
 */
export function codeRabbitVerdict({
  reviews,
  reviewsTruncated,
  threads,
  headOid,
  threadsTruncated,
  threadCount,
}: {
  reviews: readonly ReviewFacts[];
  reviewsTruncated: boolean;
  threads: readonly ThreadFacts[];
  headOid: string;
  threadsTruncated: boolean;
  threadCount: number;
}): { readonly verdict: CodeRabbitVerdict; readonly detail: string } {
  const own = reviews.filter((review) => review.login === CODERABBIT_LOGIN);
  const ownThreads = threads.filter((thread) => thread.openedByLogin === CODERABBIT_LOGIN);
  const outstanding = ownThreads.filter((thread) => !thread.isResolved && !thread.isOutdated);
  if (own.length === 0 && ownThreads.length === 0) {
    return { detail: "CodeRabbit has not posted on this pull request", verdict: "none" };
  }
  if (outstanding.length > 0) {
    return {
      detail: `${String(outstanding.length)} unresolved CodeRabbit comment(s) still open`,
      verdict: "changes-requested",
    };
  }
  // A capped thread read can only LOSE an unresolved thread, so once the page was truncated the only sound
  // answers left are the POSITIVE ones already found above. Anything that would have read as clear becomes
  // `unknown` rather than a green this read did not earn.
  if (threadsTruncated) {
    return {
      detail: `${String(threadCount)} review threads, more than one page — this read cannot prove nothing is outstanding`,
      verdict: "unknown",
    };
  }
  const opinion = lastOpinionated({ reviews: own });
  const newest = own.at(-1);
  if (opinion?.state === "CHANGES_REQUESTED") {
    return changesRequestedVerdict({
      headOid,
      newestOid: newest === undefined ? "" : newest.commitOid,
      ownThreads,
      reviewsTruncated,
    });
  }
  if (newest !== undefined && headOid !== "" && newest.commitOid !== "" && newest.commitOid !== headOid) {
    return {
      detail: `CodeRabbit last reviewed ${newest.commitOid.slice(0, 7)}, and the head is now ${headOid.slice(0, 7)}`,
      verdict: "stale",
    };
  }
  if (opinion?.state === "APPROVED") {
    return approvalVerdict({ approvedOid: opinion.commitOid, headOid });
  }
  return { detail: "CodeRabbit has commented but never given a verdict", verdict: "pending" };
}
