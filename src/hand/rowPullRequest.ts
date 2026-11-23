/**
 * Whether a check-in's board row has shipped: a `hand post --check-in --row <slug>` asks the owner to look at what that row
 * made, and a row whose pull request is still open has made nothing they can look at yet.
 *
 * ## Why
 *
 * A check-in on a page whose pull request is unmerged opens the OLD page, which loads fine, so no look at the page
 * could tell it is not the new one (`./pageLook.ts`). What could tell is the row's own pull request.
 *
 * ## Which pull request is the row's
 *
 * The three exact matches `../handover/findingGate.ts` uses to find a branch's row, read the other way round: the
 * row's declared `branch:`, the branch its run journal recorded at `handover start`, and the slug itself — never a
 * resemblance. Every pull request whose head is one of those, in the repository of the row's checkout, is the row's.
 *
 * ## The verdict
 *
 * - **None found** is no refusal: a row with no code (a page published, a setting changed) has no pull request.
 * - **Any merged** is no refusal: the work shipped, and a later open one on the same branch is a follow-up.
 * - **Only open or closed ones** refuses, naming each — the thing is not live.
 * - **The read failed** refuses too: a check that could not run is not a pass.
 *
 * Only a `--check-in` is judged. A step the owner must TAKE — a sign-in that unblocks a row mid-work — has an open pull
 * request by design, and refusing it would refuse the very step that lets the row finish.
 *
 * Pure: the read is `../cli/commands/hand/rowPullRequestsRead.ts`.
 */

/** One pull request whose head is a branch of the row's. */
export interface RowPullRequest {
  readonly number: number;
  readonly url: string;
  readonly state: "OPEN" | "MERGED" | "CLOSED";
}

/** What the post learned about the pull requests of the row a check-in names. */
export type RowPullRequests =
  /** The step is no check-in naming a row, so nothing was asked. */
  | { readonly kind: "not-asked" }
  /** Every pull request whose head is one of `branches`, in `repo`. */
  | {
      readonly kind: "read";
      readonly repo: string;
      readonly branches: readonly string[];
      readonly pulls: readonly RowPullRequest[];
    }
  /** The read could not run — no checkout to resolve the repository from, no token, a failed call. */
  | { readonly kind: "unread"; readonly why: string };

/**
 * The branches a row's pull request could have as its head: its declared branch, the one its journal recorded, and
 * its slug — each once, in that order.
 *
 * @param slug the row's slug
 * @param declared the doc's `branch:`, when it declares one
 * @param recorded the branch its run journal recorded at `handover start`, when it has one
 * @returns the candidate branch names
 */
export function rowBranchCandidates({
  slug,
  declared,
  recorded,
}: {
  slug: string;
  declared: string | undefined;
  recorded: string | undefined;
}): readonly string[] {
  const named = [declared, recorded, slug].filter((branch): branch is string => branch !== undefined && branch !== "");
  return [...new Set(named)];
}

/**
 * Why a check-in may not name this row yet, or `undefined` when it may.
 *
 * @param row the slug the step names
 * @param answer what the post learned about the row's pull requests
 * @returns the clause naming what is not live, written to follow "--row <slug>", or `undefined`
 */
export function unmergedRowProblem({ row, answer }: { row: string; answer: RowPullRequests }): string | undefined {
  if (answer.kind === "not-asked") {
    return undefined;
  }
  if (answer.kind === "unread") {
    return `whether ${row}'s pull request is merged could not be read — ${answer.why}`;
  }
  if (answer.pulls.length === 0 || answer.pulls.some((pull) => pull.state === "MERGED")) {
    return undefined;
  }
  const named = answer.pulls.map((pull) => `${pull.url} (${pull.state.toLowerCase()})`).join(", ");
  return `${row}'s pull request is not merged, so what the check-in shows the owner is not live yet: ${named}`;
}
