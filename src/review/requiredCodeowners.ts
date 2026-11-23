/**
 * Which of GitHub's pending code owners a pull request is still waiting on, and which are a LEFTOVER request
 * GitHub no longer requires anything from.
 *
 * ## The failure this was written from
 *
 * MEASURED on a pull request where GitHub recorded an approval on behalf of every one of
 * the three codeowner teams, and still held one `asCodeOwner` request open to a PERSON who owns no CODEOWNERS
 * rule at all — a team's review assignment had routed the team request to that person, and the team was
 * satisfied by somebody else. `reviewDecision` was null and `mergeStateStatus` uncomputed, so GitHub's own
 * merge status could not release the request (`./githubMergeStatus.ts`), and every reader of `blockedOn`
 * named that person: a chase DMed them for "the last codeowner tick" when the pull request was waiting only
 * on unresolved threads and a stale branch. Reproduce: `slopweaver github review-state --repo <owner/repo>
 * --number <n> --json` and compare `githubCodeowners.owners` against `codeowners.rules[].owners`.
 *
 * ## The criterion, and why every clause is in it
 *
 * A pending PERSON is a leftover only when all of these hold; any one missing keeps them pending, because the
 * costly error is releasing somebody GitHub still requires:
 *
 * - **every CODEOWNERS rule the changed paths invoke is satisfied** — `./codeownerRules.ts`, which reads
 *   GitHub's on-behalf-of team approvals as well as individual ones;
 * - **the person owns none of those rules**, so the request cannot be their own ownership — only a team's delegation;
 * - **no TEAM GitHub flags is still pending**, so there is no unsatisfied team they could be the delegate for;
 * - **GitHub's request list and the changed-path list were both read whole**, so neither a pending owner nor
 *   an invoked rule can be missing from what was judged;
 * - **the base is the default branch** — the rules are read off the default branch's CODEOWNERS
 *   (`../live/github/reviewStateQueries.ts`) while GitHub applies the BASE branch's file, so off it the rules
 *   judged may not be the rules GitHub enforces;
 * - **`reviewDecision` is empty or `APPROVED`** — GitHub stating any other decision outranks this reading.
 *
 * A TEAM is never a leftover. It is the requirement itself rather than somebody it was routed to.
 *
 * ## What this cannot see, stated rather than discovered
 *
 * A requirement that is not a CODEOWNERS rule — a ruleset demanding approval of the most recent push, say —
 * shows in `reviewDecision` where branch protection drives it and is invisible where it reads null. Releasing a
 * leftover there costs a refused press at the `github enqueue` door, never a merge GitHub would not allow.
 *
 * Pure.
 */

import type { GithubCodeowner } from "./githubCodeowners.js";
import type { PrReviewState } from "./reviewState.js";

/** GitHub's pending code owners, split into the ones still holding the pull request and the leftovers. */
export interface PendingCodeowners {
  /** Every pending owner this reading could not release, in GitHub's own order. */
  readonly holding: readonly GithubCodeowner[];
  /** Pending person requests GitHub no longer requires anything from — see this module's criterion. */
  readonly leftovers: readonly GithubCodeowner[];
}

/**
 * Whether nothing on the pull request is left that a person request could be the delegate for.
 *
 * @param state the pull request's answers
 * @returns true when every invoked rule is satisfied, no team is pending, both reads were whole, and the rules
 *   read are the base's own
 */
function requirementCleared({ state }: { state: PrReviewState }): boolean {
  const decision = state.reviewDecision;
  const decisionAllows = decision === "" || decision === "APPROVED";
  const teamPending = state.githubCodeowners.owners.some((owner) => owner.kind === "team" && owner.state === "pending");
  return (
    state.codeowners.verdict === "satisfied" &&
    decisionAllows &&
    !teamPending &&
    !state.githubCodeowners.requestsTruncated &&
    state.changedPathsTruncated !== true &&
    state.codeownersOffBase !== true
  );
}

/**
 * Split GitHub's pending code owners into the ones still holding the pull request and the leftover requests.
 *
 * @param state the pull request's answers
 * @returns the holding owners and the leftovers, each in GitHub's own order
 */
export function pendingCodeowners({ state }: { state: PrReviewState }): PendingCodeowners {
  const pending = state.githubCodeowners.owners.filter((owner) => owner.state !== "approved");
  if (!requirementCleared({ state })) {
    return { holding: pending, leftovers: [] };
  }
  const ruleOwners = new Set(
    state.codeowners.rules.flatMap((rule) => rule.owners).map((token) => token.replace(/^@/, "").toLowerCase()),
  );
  const isLeftover = (owner: GithubCodeowner): boolean =>
    owner.kind === "user" && !ruleOwners.has(owner.token.replace(/^@/, "").toLowerCase());
  return {
    holding: pending.filter((owner) => !isLeftover(owner)),
    leftovers: pending.filter((owner) => isLeftover(owner)),
  };
}
