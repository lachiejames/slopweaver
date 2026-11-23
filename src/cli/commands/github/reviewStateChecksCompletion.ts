/**
 * Read the WHOLE check list of every head the fleet read could only see one page of.
 *
 * ## Why a fleet read stops at one page, and why that parked the owner's presses
 *
 * The fleet query asks each head for `contexts(first: CHECK_PAGE)`, and 100 is GitHub's own per-connection
 * ceiling (`../../../live/github/reviewState.ts`). A head carrying more contexts than that comes back
 * `checksTruncated`, and a truncated rollup can only ever LOSE a failing check, so `ciTest` answers `unknown`
 * and no row of it can read `press`. That was the right answer while every head fitted on the page.
 *
 * MEASURED over the owner's 47 open pull requests on both repositories: acme-admin heads carry more than
 * 100 contexts, and three green bumps read `ci-green could not be answered: 1
 * context(s) staging REQUIRES were not on the truncated page this read saw: Required CI`, with six more
 * held back as `check-contexts is unread`. A merge the owner standing-ordered was
 * skipped by a read that never saw the context it needed. Reproduce:
 *
 * ```bash
 * slopweaver github landing --repo acme/acme-admin --author @me --json | jq '[.rows[]|select(.checksTruncated)]|length'
 * ```
 *
 * ## Why one paged re-read per truncated head, not one aliased page-two read for the fleet
 *
 * `../../../live/github/checksRead.ts` already pages a head's contexts, dedupes a re-run whose two halves land
 * on different pages, and refuses a list stitched across two heads. An aliased page-two read would rebuild all
 * three over raw nodes carried on every row. The cost is bounded rather than hidden:
 * only a truncated head is re-read, at most {@link CHECK_COMPLETION_CONCURRENCY} at a time, and each costs at
 * most `DECISION_CHECK_LIMIT / 100` requests (`../../../live/github/checksRead.ts`) — two for a head of 101-200
 * contexts.
 *
 * A re-read that fails, finds the head moved, or is STILL truncated at the limit leaves the row exactly as the
 * fleet read it, so it stays honestly `unknown`, and says so on the diagnostic channel — never a green.
 */

import { createConcurrencyLimiter } from "#lib/resilience.js";

import type { FetchGithubChecks } from "../../../live/github/checks.js";
import type { PrLiveState } from "../../../live/github/reviewState.js";
import { wholeChecksOutcome } from "../../../live/github/wholeChecks.js";

/** How many truncated heads are re-read at once — enough to keep a fleet of thirty under a few seconds. */
export const CHECK_COMPLETION_CONCURRENCY = 4;

/** The edges one completion pass needs. */
export interface ChecksCompletionDeps {
  /** The paged checks read `github checks` uses. */
  readonly fetchChecks: FetchGithubChecks;
  /** Where a head the pass could not complete is named, with why. */
  readonly onProblem: (line: string) => void;
}

/**
 * Complete one truncated head, or say why it stays as the fleet read it.
 *
 * @returns the pull request with its whole check list, or the original pull request untouched
 */
async function completeOne({
  pr,
  deps,
  totalLimit,
}: {
  pr: PrLiveState;
  deps: ChecksCompletionDeps;
  totalLimit: number;
}): Promise<PrLiveState> {
  const label = `${pr.repoSlug}#${String(pr.number)}`;
  const [owner, repo, extra] = pr.repoSlug.split("/");
  if (owner === undefined || owner === "" || repo === undefined || repo === "" || extra !== undefined) {
    deps.onProblem(`could not complete ${label}'s checks: its repository slug is not owner/name`);
    return pr;
  }
  const answer = await deps.fetchChecks({ limit: totalLimit, number: pr.number, owner, repo });
  if (answer.isErr()) {
    deps.onProblem(`could not complete ${label}'s checks past the first page: ${answer.error.message}`);
    return pr;
  }
  const outcome = wholeChecksOutcome({ pr, whole: answer.value });
  switch (outcome.kind) {
    case "complete":
      return outcome.pr;
    case "head-moved":
      deps.onProblem(
        `could not complete ${label}'s checks: the head moved from ${pr.headOid} to ${outcome.readHead} ` +
          "between the fleet read and the re-read, so its CI stays unknown",
      );
      return pr;
    case "still-truncated":
      deps.onProblem(`${label} still carries more than ${String(totalLimit)} check contexts, so its CI stays unknown`);
      return pr;
    default: {
      const unreachable: never = outcome;
      return unreachable;
    }
  }
}

/**
 * Re-read every truncated head's whole check list, leaving every other pull request untouched and in order.
 *
 * @param prs every pull request the fleet read returned
 * @param totalLimit the most contexts one head is read for, across all its pages
 * @param concurrency how many heads are re-read at once
 * @returns the same pull requests, in the same order, each truncated head complete where it could be
 */
export async function completeTruncatedChecks({
  prs,
  deps,
  totalLimit,
  concurrency,
}: {
  prs: readonly PrLiveState[];
  deps: ChecksCompletionDeps;
  totalLimit: number;
  concurrency: number;
}): Promise<readonly PrLiveState[]> {
  if (!prs.some((pr) => pr.checksTruncated)) {
    return prs;
  }
  const limit = createConcurrencyLimiter({ concurrency });
  return Promise.all(
    prs.map(async (pr) => (pr.checksTruncated ? limit(() => completeOne({ deps, pr, totalLimit })) : pr)),
  );
}
