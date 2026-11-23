/**
 * GitHub's own `mergeStateStatus` — *would GitHub let you merge this right now* — and the ONE predicate that
 * says when a pending code-owner REQUEST is therefore not a requirement.
 *
 * ## The question this answers, and the one it does not
 *
 * `./githubCodeowners.ts` reads GitHub's request register: who GitHub has ASKED for a review. That register
 * says nothing about whether branch protection REQUIRES any of them, and a landing read that treated the two
 * as the same claim would read `waiting on a human review` on a pull request GitHub itself was offering
 * "Merge when ready" on.
 *
 * The rule: the bot clicks ready to merge on pull requests that have passed every other check. The worked
 * case is a pull request with three approvals, every check green, no conflicts, GitHub offering the queue
 * button, and one open `asCodeOwner` request still out. The request was not a required review on that base,
 * and the chair had to press it by hand.
 *
 * ## Why the positive set is three tokens and not "anything but `BLOCKED`"
 *
 * GitHub documents `mergeStateStatus` as a detailed merge status; it documents **no precedence** among
 * simultaneous blockers. So the complement of `BLOCKED` proves nothing, and a Codex planning pass refused an
 * earlier draft of this module for assuming one. Only the three tokens GitHub documents as *mergeable* are
 * read as clearing the request:
 *
 * | token | what it is read as |
 * | --- | --- |
 * | `CLEAN`, `UNSTABLE`, `HAS_HOOKS` | GitHub reports the merge ALLOWED — the pending request is not required |
 * | `BLOCKED` | GitHub reports it blocked; it does not say the reviewer is the cause, so the hold stays |
 * | `BEHIND`, `DIRTY`, `DRAFT`, `UNKNOWN` | none of these establishes review satisfaction — the hold stays |
 * | absent, null, or a token this repository has not seen | `unread`; the hold stays |
 *
 * `UNSTABLE` means GitHub allows the merge while a NON-required check is failing, so it clears this one
 * heuristic and nothing else: the `ci-green` test reads the checks itself, and passes a red only when
 * `./landingCiFailure.ts` proves every failing check advisory from the required set this read took.
 *
 * Pure. No network, no clock, no filesystem.
 */

/** The three tokens GitHub documents as a mergeable state, declared once so no consumer restates the set. */
const MERGEABLE_STATUSES: readonly ["CLEAN", "UNSTABLE", "HAS_HOOKS"] = ["CLEAN", "UNSTABLE", "HAS_HOOKS"];

/** The four tokens GitHub documents that establish nothing either way about review satisfaction. */
const UNPROVEN_STATUSES: readonly ["BEHIND", "DIRTY", "DRAFT", "UNKNOWN"] = ["BEHIND", "DIRTY", "DRAFT", "UNKNOWN"];

/**
 * What GitHub said about merging this pull request, classified rather than carried as a bare token.
 *
 * Four arms rather than the eight tokens, because a consumer that cannot tell `unread` from `unproven`
 * cannot report which one held a row back — and a bare token invites each consumer to invent its own
 * allowlist, which is the drift {@link githubMergeStatus} exists to make impossible. Every arm carries what
 * a reader needs to see the sentence it produced.
 */
export type GithubMergeStatus =
  /** GitHub reports the merge ALLOWED. The only arm that clears anything. */
  | { readonly kind: "mergeable"; readonly status: "CLEAN" | "UNSTABLE" | "HAS_HOOKS" }
  /** GitHub reports the merge blocked — but never says by WHAT, so no consumer may name a cause. */
  | { readonly kind: "blocked"; readonly status: "BLOCKED" }
  /** A documented token that settles nothing about review: out of date, conflicting, draft, or still computing. */
  | { readonly kind: "unproven"; readonly status: "BEHIND" | "DIRTY" | "DRAFT" | "UNKNOWN" }
  /** The field was absent, null, or a token this repository does not know. */
  | { readonly kind: "unread"; readonly why: string };

/** How an unread status describes what stood in the field, for the sentence a row prints. */
function describeUnread({ value }: { value: unknown }): string {
  if (value === undefined) {
    return "this read carried no mergeStateStatus for it";
  }
  if (value === null) {
    return "GitHub returned a null mergeStateStatus for it";
  }
  if (typeof value === "string") {
    return `GitHub returned a mergeStateStatus this read does not know (${value})`;
  }
  return `the mergeStateStatus field held ${typeof value} rather than a token`;
}

/**
 * Classify whatever a read carried in `mergeStateStatus`.
 *
 * Total by construction: anything that is not one of GitHub's eight documented tokens becomes `unread`
 * naming what stood there, so there is no input for which this manufactures a `mergeable`. That is why it
 * answers a value rather than a `Result` — nothing here can fail, only fail to establish.
 *
 * @param value the raw field, exactly as the GraphQL response carried it
 * @returns the classified status
 */
export function githubMergeStatus({ value }: { value: unknown }): GithubMergeStatus {
  const mergeable = MERGEABLE_STATUSES.find((token) => token === value);
  if (mergeable !== undefined) {
    return { kind: "mergeable", status: mergeable };
  }
  if (value === "BLOCKED") {
    return { kind: "blocked", status: "BLOCKED" };
  }
  const unproven = UNPROVEN_STATUSES.find((token) => token === value);
  if (unproven !== undefined) {
    return { kind: "unproven", status: unproven };
  }
  return { kind: "unread", why: describeUnread({ value }) };
}

/**
 * Whether an open code-owner request on this pull request is NOT a review its base branch requires.
 *
 * Three things are load-bearing here and every one of them is conservative.
 *
 * - **GitHub must have said `mergeable`.** Everything else — blocked, unproven, unread — leaves the hold
 *   exactly where it was, so this predicate can only ever release a row GitHub itself is already offering to
 *   merge.
 * - **The requests read must be COMPLETE.** A capped request page LOSES a pending owner, so on a truncated
 *   read the register this is arguing about is not even fully known. Relaxing that at the same time would be
 *   two policy changes wearing one name.
 * - **GitHub must have stated NO review decision.** `CLEAN` is an answer about branch protection; it is not
 *   a reviewer withdrawing `CHANGES_REQUESTED`. Without this, `mergeStateStatus: CLEAN` plus `reviewDecision: CHANGES_REQUESTED` passed the fleet's
 *   `codeowners-satisfied` test while the enqueue door refused the identical inputs at its own
 *   `reviewFinding` — a read planning a press the write would not take. The decision arrives spelled two
 *   ways (`undefined` from the door's query, `""` from the fleet's), so this owns the comparison rather than
 *   leaving each caller to make it.
 *
 * @param mergeStatus GitHub's classified answer to whether it would merge this now
 * @param requestsTruncated whether GitHub reported more review requests than the read carried
 * @param reviewDecision GitHub's aggregate decision field, absent or empty where it stated none
 * @returns true only where GitHub allows the merge over a fully-read request register and stated no decision
 */
export function pendingCodeownerRequestIsNonBlocking({
  mergeStatus,
  requestsTruncated,
  reviewDecision,
}: {
  mergeStatus: GithubMergeStatus;
  requestsTruncated: boolean;
  reviewDecision: string | undefined;
}): boolean {
  const decisionStated = reviewDecision !== undefined && reviewDecision.length > 0;
  return mergeStatus.kind === "mergeable" && !requestsTruncated && !decisionStated;
}

/**
 * Whether GitHub reports the merge BLOCKED while stating no review decision at all.
 *
 * The other half of {@link pendingCodeownerRequestIsNonBlocking}: that one asks whether a PRESENT request is
 * a requirement, this one whether an EMPTY register is an approval. MEASURED on
 * a pull request in `acme/acme-admin` — BLOCKED, `reviewDecision: null`, no open request, nobody approved — a review a
 * ruleset requires leaves the decision field null, so an absent decision under BLOCKED says nothing. Both the
 * landing test and the enqueue door ask THIS, so the read and the write cannot disagree on one input. It
 * names no cause: a running required check blocks the same way, which each caller separates by CI.
 * Reproduce: `slopweaver github read <pull-request-url> --json`.
 *
 * @param mergeStatus GitHub's classified answer to whether it would merge this now
 * @param reviewDecision GitHub's aggregate decision field, absent or empty where it stated none
 * @returns true only for a `blocked` status with no decision stated
 */
export function blockedWithoutReviewDecision({
  mergeStatus,
  reviewDecision,
}: {
  mergeStatus: GithubMergeStatus;
  reviewDecision: string | undefined;
}): boolean {
  const decisionStated = reviewDecision !== undefined && reviewDecision.length > 0;
  return mergeStatus.kind === "blocked" && !decisionStated;
}

/**
 * The clause a row prints for a status that did NOT clear a pending request, in GitHub's own terms.
 *
 * One function because three surfaces print it — the landing test, the enqueue door's finding and the
 * bump read that quotes the test — and a fourth wording would be a fourth thing to keep true.
 *
 * @param mergeStatus GitHub's classified answer
 * @returns the clause, which never claims GitHub named the reviewer as the cause
 */
export function mergeStatusClause({ mergeStatus }: { mergeStatus: GithubMergeStatus }): string {
  if (mergeStatus.kind === "unread") {
    return mergeStatus.why;
  }
  if (mergeStatus.kind === "blocked") {
    return "GitHub reports the merge BLOCKED, without saying by what";
  }
  if (mergeStatus.kind === "unproven") {
    return `GitHub reports ${mergeStatus.status}, which settles nothing about review`;
  }
  return `GitHub reports ${mergeStatus.status}, so it would merge this now`;
}
