/**
 * The GitHub leg's effectful read: one live `review-state` pass over every repository the owner declares.
 *
 * ## It calls the verb's own collector rather than a second implementation of it
 *
 * {@link ../github/reviewStateRun.collectReviewStates} performs the fleet read, both Slack legs and the
 * CODEOWNERS fetch, and it is the only thing in the repository that decides what a pull request's state
 * is. This leg consumes it. A second copy of that logic would drift from the verb the owner reads, and the
 * whole reason this leg exists is that its answer and the verb's are the same answer.
 *
 * ## The repository list comes from the checkouts the owner DECLARED, not from the one this process is in
 *
 * `slopweaver pane pr-status` watches a single repository by default, and measured on the owner's data, 33 of the owner's
 * 35 open pull requests are in the other one. A leg defaulting to the current checkout would silently
 * report the two it could see as the whole picture — the `audit run` failure class, where a partial answer
 * prints as a complete one. So the repositories are every `mainCheckouts` entry in `profile.json`, each
 * resolved through its own `origin` remote, and a checkout whose remote will not resolve is named in
 * `couldNotSee` rather than dropped in silence.
 *
 * ## Drafts are included, and that was measured rather than assumed
 *
 * `review-state` excludes them by default because a draft is not ready to be asked about. Session-start
 * wants them anyway — an unfinished pull request of the owner's own is work tasked to the owner — and the fear was that
 * including them would flood the list. Measured across both repositories: 3 of 38.
 */

import { err, ok, type Result } from "../../../lib/result.js";
import { readDeclaredRepositories } from "../../../live/github/declaredRepositories.js";
import { CHECK_PAGE } from "../../../live/github/reviewState.js";
import { githubLeg } from "../../../sessionStart/githubLeg.js";
import type { RankInput } from "../../../sessionStart/rank.js";
import type { GithubReviewStateArgs } from "../github/reviewStateCore.js";
import type { GithubReviewStateDeps, ReviewStateRead } from "../github/reviewStateRun.js";
import { collectReviewStates, productionGithubReviewStateDeps } from "../github/reviewStateRun.js";
import { type SessionStartError, SessionStartErrors } from "./errors.js";
import { selfBotIds } from "./slackPeople.js";

/**
 * The search author, which is GitHub's own token-relative spelling.
 *
 * A literal login would be a private identifier committed to this repository, and it would also be wrong
 * for anybody else's install. `@me` resolves against whichever credential the read is made with.
 */
export const SEARCH_AUTHOR = "@me";

/** How many open pull requests one run will read. Above the owner's measured 38, and GitHub's search caps at 1000. */
export const PR_LIMIT = 200;

/** The changed paths requested per pull request, matching the verb's own default. */
const FILE_LIMIT = 100;

/**
 * The search page size, matching the verb's own default, because they must agree.
 *
 * MEASURED: at 50 this leg read **zero** pull requests and reported *"GitHub returned no search
 * connection for the fleet read"*, while the identical query over the identical two repositories answered
 * 33 rows at 20. A page is the only lever over one request's nested node count — the rollup, the reviews,
 * the threads and the files all multiply by it — so a page GitHub will not serve fails the whole read
 * rather than degrading it, and this leg then reports the failure as a `could not see:` line a reader
 * skims past. The verb's own default is the measured-safe number and this must not drift from it again.
 */
const PAGE_SIZE = 20;

/**
 * What one GitHub read produced, including why it produced nothing when it did.
 *
 * @internal the contract between this read and the verb's own shell.
 */
export interface GithubRead {
  /** The pull requests that survived, already mapped to ranker input. */
  readonly inputs: readonly RankInput[];
  /** How many open pull requests were read, so the verb can say what fraction became rows. */
  readonly pullRequestsRead: number;
  /** How many of them are somebody else's move, and so are not on the list. */
  readonly waitingOnSomebodyElse: number;
  /** What this leg could not see, in the words the verb prints. */
  readonly couldNotSee: readonly string[];
}

/**
 * The repository slugs to read, from the main checkouts the owner declared.
 *
 * @param home the state home holding `profile.json`
 * @returns each declared checkout's `origin` slug, and a line per checkout that would not resolve
 */
function declaredRepoSlugs({ home }: { home: string }): {
  readonly slugs: readonly string[];
  readonly couldNotSee: readonly string[];
} {
  const { slugs, unresolved } = readDeclaredRepositories({ home });
  const couldNotSee = unresolved.map(
    (path) => `your pull requests in ${path} are not here: its \`origin\` remote could not be resolved`,
  );
  return { couldNotSee, slugs };
}

/**
 * The invocation this leg makes of the review-state collector.
 *
 * @param home the state home
 * @param slugs the repositories to search
 * @returns the parsed arguments, as if they had been typed
 */
export function githubLegArgs({ home, slugs }: { home: string; slugs: readonly string[] }): GithubReviewStateArgs {
  return {
    author: SEARCH_AUTHOR,
    detail: false,
    checkLimit: CHECK_PAGE,
    fileLimit: FILE_LIMIT,
    home,
    includeDrafts: true,
    json: false,
    limit: PR_LIMIT,
    number: undefined,
    readBaseDistance: false,
    pageSize: PAGE_SIZE,
    repos: slugs,
    slackLive: true,
  };
}

/**
 * The limits one read carries, in the words the verb prints.
 *
 * The Slack residue is carried through verbatim rather than restated, because the coverage the collector
 * measured is the coverage this leg's own `asked` answers rest on.
 *
 * @param read what the collector returned
 * @returns one line per limit
 */
export function readLimits({ read }: { read: ReviewStateRead }): readonly string[] {
  const lines = [...read.coverage.residue];
  if (read.states.length < read.total) {
    lines.push(
      `only ${String(read.states.length)} of your ${String(read.total)} open pull requests were read — the rest are not on this list`,
    );
  }
  return lines;
}

/**
 * Read every open pull request of the owner's and turn it into ranker input.
 *
 * @param home the state home holding the profile, credentials, corpus and roster
 * @param nowIso the run's own instant, supplied rather than read
 * @param deps the review-state seams, injectable so the pairing is testable without a network
 * @returns the leg's inputs and limits, or what stopped it
 */
export async function readGithubPullRequests({
  home,
  nowIso,
  deps = productionGithubReviewStateDeps(),
}: {
  home: string;
  nowIso: string;
  deps?: GithubReviewStateDeps;
}): Promise<Result<GithubRead, SessionStartError>> {
  const declared = declaredRepoSlugs({ home });
  if (declared.slugs.length === 0) {
    return err(SessionStartErrors.noMainCheckouts());
  }
  const read = await collectReviewStates({
    args: githubLegArgs({ home, slugs: declared.slugs }),
    deps,
    repositoryResolutionVerb: undefined,
  });
  if (read.isErr()) {
    return err(SessionStartErrors.reviewStatesUnread({ reasons: read.error }));
  }
  const botIds = [...selfBotIds({ home })];
  const inputs = githubLeg({
    botIds,
    namesById: read.value.roster.nameForSlackId,
    nowIso,
    states: read.value.states,
  });
  return ok({
    couldNotSee: [...declared.couldNotSee, ...readLimits({ read: read.value })],
    inputs,
    pullRequestsRead: read.value.states.length,
    waitingOnSomebodyElse: inputs.filter((input) => input.ruleZero.verdict === "suppress").length,
  });
}
