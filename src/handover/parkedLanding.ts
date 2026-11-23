/**
 * What a park on a pull request's CI comes to once that pull request has ENDED — the reconcile `handover wake`'s
 * finish pass runs over every due checks park it read MERGED or CLOSED. Pure: the head read and the run's branches
 * arrive as arguments.
 *
 * MEASURED (`slopweaver handover wake --dry-run` over the live board): 66 waking parks, all 66 due, every
 * one a checks park whose pull request had merged (64) or closed (2), and the board printed each as "parked on CI for
 * …, seat closed" days after it landed. The finish the wake already offered a merged park refused on the lessons
 * gate every time, because the seat that held the run's context closed itself on the park before answering it, so
 * each row fell to a reseat booting a whole seat to run `finish`, three a tick.
 *
 * `handover park --wake-on-checks` refuses the run's OWN open pull request (`./ownLandingPark.ts`), so a
 * new own-landing park cannot join that backlog; a park on somebody else's pull request — a stack parent — still
 * can, and its merge means the seat's OWN work is next. So the reconcile tells those apart before settling anything:
 *
 * - **landed** — the pull request MERGED, its head is one of this run's own branches, and the park carries no open
 *   question and no drafts: the branch landed and only the bookkeeping is owed.
 * - **hiding-step** — the park left something a person or a seat still has to do: an open question, a draft never
 *   sent, or the pull request was somebody else's branch, so its merge unblocked work rather than finishing it. A
 *   finish that still refuses on a landed row is the fourth cause, set by the wake once finish has answered.
 * - **closed-unmerged** — the run's own pull request CLOSED without merging, so the work it carried is still owed.
 * - **unknown** — the head did not read, or the branch the seat had out cannot be ruled out, so nothing is claimed.
 *
 * Only `landed` changes what the wake does (`../cli/commands/handover/wakeDueFinish.ts`); every other class keeps
 * the path it always had, and is reported by name so a row hiding a real step is visible rather than settled.
 * A question that is ALL a merged park left is the wake's question pass instead
 * (`../cli/commands/handover/wakeQuestionPass.ts`): it classes the park with that question set aside, and a `landed`
 * answer suspends the wake rather than reseating a seat that could only close again.
 */

/** Why a park on an ended pull request is not just bookkeeping. */
type HidingStepCause = "question" | "drafts" | "other-branch" | "finish-refusal";

/** What one park on an ended pull request comes to. */
export type ParkedLanding =
  | { readonly kind: "landed"; readonly headRefName: string }
  | { readonly kind: "hiding-step"; readonly cause: HidingStepCause; readonly detail: string }
  | { readonly kind: "closed-unmerged"; readonly headRefName: string }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * Classify one park on a pull request that has merged or closed.
 *
 * The question and the drafts are read first: a park that asked something or left a message unsent is hiding a
 * step whichever branch merged. A head matching none of the run's branches is somebody else's only when every
 * branch the run may own READ; while one is unknown (a worktree gone, detached or unread) that branch may be the
 * very head, so the park reads `unknown` rather than being judged either way.
 *
 * @param prState what GitHub says the pull request came to
 * @param head the pull request's head branch, or why it did not read
 * @param ownBranches every branch this run may own that did read: its doc's `branch:`, the branch it recorded at
 *   `start`, and the one its worktree has out
 * @param branchUnread why one branch the run may own is unknown, when one is
 * @param question the park's open question, when it asked one
 * @param draftCount how many drafts the park left
 * @returns what the park comes to
 */
export function classifyParkedLanding({
  branchUnread,
  draftCount,
  head,
  ownBranches,
  prState,
  question,
}: {
  prState: "MERGED" | "CLOSED";
  head: { readonly kind: "read"; readonly headRefName: string } | { readonly kind: "unread"; readonly reason: string };
  ownBranches: readonly string[];
  branchUnread: string | undefined;
  question: string | undefined;
  draftCount: number;
}): ParkedLanding {
  if (question !== undefined && question.trim() !== "") {
    return { cause: "question", detail: `the park asked "${question.trim()}"`, kind: "hiding-step" };
  }
  if (draftCount > 0) {
    return { cause: "drafts", detail: `the park left ${String(draftCount)} draft(s) unsent`, kind: "hiding-step" };
  }
  if (head.kind === "unread") {
    return { kind: "unknown", reason: `the pull request's head did not read: ${head.reason}` };
  }
  const { headRefName } = head;
  if (!ownBranches.includes(headRefName)) {
    if (branchUnread !== undefined) {
      return {
        kind: "unknown",
        reason: `its head ${headRefName} is none of ${branchList({ ownBranches })}, but ${branchUnread}`,
      };
    }
    return {
      cause: "other-branch",
      detail: `its head ${headRefName} is none of ${branchList({ ownBranches })}, so the merge unblocked this run's own work`,
      kind: "hiding-step",
    };
  }
  if (prState === "CLOSED") {
    return { headRefName, kind: "closed-unmerged" };
  }
  return { headRefName, kind: "landed" };
}

/** The run's own branches, named for a sentence. */
function branchList({ ownBranches }: { ownBranches: readonly string[] }): string {
  if (ownBranches.length === 0) {
    return "this run's branches (it names none)";
  }
  return `this run's branches (${ownBranches.join(", ")})`;
}

/**
 * The `handover close --summary` the wake records once a landed row's finish closed its run, so the row derives
 * `done` (`./derivedRowState.ts`) rather than standing as AWAITING SHIP: the pull request and the commit it merged at,
 * which is the same witness a landing settle carries.
 *
 * @param repo the `owner/repo` the park waited on
 * @param number the pull request's number
 * @param headRefName the run's own branch that merged
 * @param mergeCommitOid the merge commit GitHub reported
 * @returns the one-line summary
 */
export function landedCloseSummary({
  headRefName,
  mergeCommitOid,
  number,
  repo,
}: {
  repo: string;
  number: number;
  headRefName: string;
  mergeCommitOid: string;
}): string {
  return `${repo}#${String(number)} (${headRefName}) merged at ${mergeCommitOid}; settled by handover wake's reconcile`;
}
