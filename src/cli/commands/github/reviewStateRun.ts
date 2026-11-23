/** The effectful shell for `slopweaver github review-state`. Read-only: it writes nothing anywhere. */

import { setTimeout as delay } from "node:timers/promises";

import { type ConflictPathsRead, measureConflictingPaths } from "../../../checkouts/conflictPaths.js";
import { githubToken, parseRepositorySlug, type Repository, resolveRepository } from "../../../config.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { type BaseDistanceRead, makeBaseDistanceRead } from "../../../live/github/baseDistance.js";
import type { FetchGithubChecks } from "../../../live/github/checks.js";
import { DECISION_CHECK_LIMIT, makeFetchGithubChecks } from "../../../live/github/checksRead.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import { type MergeableRecheck, makeMergeableRecheck } from "../../../live/github/mergeableRecheck.js";
import { makeGithubMergeQueueReads } from "../../../live/github/mergeQueue.js";
import { githubReadGraphql, githubReadRest } from "../../../live/github/read.js";
import { resolveGithubRepository } from "../../../live/github/repositoryResolution.js";
import type { RequiredSetRead } from "../../../live/github/requiredContexts.js";
import {
  type GithubReviewStateApi,
  makeGithubReviewStateApi,
  type PrLiveState,
} from "../../../live/github/reviewState.js";
import type { ReviewRoster } from "../../../review/reviewRoster.js";
import type { PrReviewState } from "../../../review/reviewState.js";
import { type SlackCoverage } from "../../../review/slackEvidenceTypes.js";
import { stackKey, stackPlaces } from "../../../review/stack.js";
import { liveReviewRoster } from "../../../review/storeReviewRoster.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { resolveHome } from "../../optionParsers.js";
import { githubVerbErrorLines } from "./errors.js";
import { githubReviewStateUsage } from "./reportUsage.js";
import type { RepositoryResolutionVerb, ResolveGithubRepository } from "./repositoryResolutionGate.js";
import { addBaseDistance } from "./reviewStateBaseDistance.js";
import { CHECK_COMPLETION_CONCURRENCY, completeTruncatedChecks } from "./reviewStateChecksCompletion.js";
import { readCodeowners, repoSlugsOf } from "./reviewStateCodeowners.js";
import { type GithubReviewStateArgs, parseGithubReviewStateArgs } from "./reviewStateCore.js";
import { reviewStateDetailBlock } from "./reviewStateDetail.js";
import type { PageDeadline } from "./reviewStateFleet.js";
import { assembleReviewState } from "./reviewStateReport.js";
import { readProvenSelection } from "./reviewStateRepositories.js";
import { baseKey, gateFor } from "./reviewStateRequiredContexts.js";
import { baseResidue } from "./reviewStateResidue.js";
import { settleMergeable } from "./reviewStateSettle.js";
import { gatherSlack, mentionsFor, productionSlackLegDeps, type SlackLegDeps } from "./reviewStateSlack.js";
import { REVIEW_STATE_HEADER, recommendationTally, reviewStateDocument, reviewStateRow } from "./reviewStateTable.js";

const VERB_ARG_OFFSET = 4;

/**
 * Injectable command edges, so the shell is exercised by plain fakes with no Octokit, Slack or corpus.
 *
 * Every Slack seam is inherited from {@link SlackLegDeps} rather than restated: the Slack legs own that
 * contract, and a second copy here is a copy nothing compares — the exact drift `area-cli.md` records
 * `CommandMeta` having grown twenty disagreeing fields through.
 */
export interface GithubReviewStateDeps extends SlackLegDeps {
  readonly resolveRepo: (args: { explicit: string | undefined }) => Result<Repository>;
  /**
   * Whether GitHub resolves one repository — asked only of a requested repository the fleet read returned no
   * row for, and only when the caller names a refusing verb (`./reviewStateRepositories.ts`).
   */
  readonly resolveRepository: ResolveGithubRepository;
  readonly api: (args: { home: string | undefined }) => GithubReviewStateApi;
  /**
   * Ask GitHub again for the pull requests whose mergeability it answered `UNKNOWN`.
   *
   * Its own module carries the measurement that makes it one bounded round trip rather than a poll
   * (`../../../live/github/mergeableRecheck.ts`). Injected beside {@link GithubReviewStateDeps.api} rather
   * than folded into it because it runs ONCE for the whole fleet, after every page is in, and the API seam
   * is per-page.
   */
  readonly mergeableRecheck: (args: { home: string | undefined }) => MergeableRecheck;
  /**
   * The paged checks read that completes a head the fleet page could only see 100 contexts of.
   *
   * Called only for a `checksTruncated` head, never for the whole fleet; `./reviewStateChecksCompletion.ts`
   * carries the measurement that made a one-page read skip the owner's standing-ordered presses.
   */
  readonly checksCompletion: (args: { home: string | undefined }) => FetchGithubChecks;
  /**
   * How far each head is from its base — one aliased request for the whole fleet.
   *
   * Called only when the invocation asked for it (`GithubReviewStateArgs.readBaseDistance`), because only
   * `github landing` prints it. `../../../live/github/baseDistance.ts` carries what the request costs and
   * why a failure is split rather than written off.
   */
  readonly baseDistances: (args: { home: string | undefined }) => BaseDistanceRead;
  /** The review roster over one read of the store's identity roster; the store's refusal stops the verb. */
  readonly roster: typeof liveReviewRoster;
  /**
   * Which paths a CONFLICTING pull request conflicts on, measured in a local checkout — called only for a
   * pull request GitHub already reports as conflicting, never for the whole fleet.
   */
  readonly conflictPaths: (args: {
    home: string;
    repoSlug: string;
    number: number;
    baseRefName: string;
    headOid: string;
  }) => ConflictPathsRead;
  /**
   * What status-check contexts a base branch requires — classic protection and rulesets, unioned.
   *
   * Injected rather than folded into {@link GithubReviewStateDeps.api} because it is a different transport:
   * the ruleset half is REST, and the seam that already unions both lives on the merge-queue reads
   * (`../../../live/github/mergeQueue.ts`). One read per distinct repository and base branch, never one per
   * pull request — twenty of the owner's open pull requests share two bases.
   */
  readonly requiredContexts: (args: {
    home: string | undefined;
    owner: string;
    repo: string;
    branch: string;
  }) => Promise<Result<readonly string[], GithubLiveError>>;
  /** A monotonic millisecond clock the fleet budget is measured on, which a wall-clock step cannot move. */
  readonly monotonicMs: () => number;
  /** The timer a fleet page races, so a page stuck in any queue before `fetch` is abandoned at its timeout. */
  readonly pageDeadline: PageDeadline;
  readonly writeOut: (line: string) => void;
}

/**
 * The REQUIRED SET for every distinct base branch in the read, one live call each.
 *
 * It answers what each base DEMANDS and nothing about any head, which is the scope that read genuinely has.
 * The gate a row carries is built per pull request by {@link gateFor}, from this shared set plus that head's
 * own checks — see `../../../live/github/requiredContexts.ts`'s {@link RequiredSetRead} for the 18-of-23
 * false red that came of computing both halves here.
 *
 * A failed read becomes an `unreadable` set for that base rather than a failed run: the required set makes a
 * red check easier to judge, and losing it must never cost a reader the twenty answers that did arrive. The
 * reason travels on the set, so the block prints WHY it could not tell a required red from an advisory one
 * instead of quietly calling it advisory.
 *
 * @param deps the injected edges, for the required-context read
 * @param home the state home whose credential the read uses
 * @param prs every pull request in this run
 * @returns one required set per {@link baseKey}
 */
async function readRequiredSets({
  deps,
  home,
  prs,
}: {
  deps: GithubReviewStateDeps;
  home: string | undefined;
  prs: readonly PrLiveState[];
}): Promise<ReadonlyMap<string, RequiredSetRead>> {
  const sets = new Map<string, RequiredSetRead>();
  const seen = new Map<string, PrLiveState>();
  for (const pr of prs) {
    if (pr.repoSlug !== "" && pr.baseRefName !== "" && !seen.has(baseKey({ pr }))) {
      seen.set(baseKey({ pr }), pr);
    }
  }
  for (const [key, pr] of seen) {
    const [owner = "", repo = ""] = pr.repoSlug.split("/");
    const answered = await deps.requiredContexts({ branch: pr.baseRefName, home, owner, repo });
    sets.set(
      key,
      answered.isErr()
        ? { kind: "unreadable", reason: answered.error.message }
        : { kind: "read", required: answered.value },
    );
  }
  return sets;
}

/**
 * Everything one review-state read produced, before anything renders it.
 *
 * Separated from {@link runGithubReviewState} so a second consumer — the session-start GitHub leg — reads
 * the same answers through the same seams instead of reimplementing the fleet read, the two Slack legs and
 * the CODEOWNERS fetch. There is one place that decides what a pull request's state is, and this is it.
 *
 * @internal the contract between this read and the verbs that render it.
 */
export interface ReviewStateRead {
  readonly states: readonly PrReviewState[];
  readonly coverage: SlackCoverage;
  readonly roster: ReviewRoster;
  /** How many open pull requests GitHub said matched, which `--limit` may have truncated. */
  readonly total: number;
}

/**
 * Read every open pull request the selection matches and answer the seven questions about each.
 *
 * @param args a parsed invocation
 * @param deps the repo-resolution, GitHub, Slack, corpus, roster, clock and output seams
 * @param repositoryResolutionVerb the verb that refuses a requested repository no row proved, named in its
 * refusal; undefined for a caller that reports an unreadable repository per repository instead
 * @returns the answers with their coverage, or the problems that stopped the read
 */
export async function collectReviewStates({
  args,
  deps,
  repositoryResolutionVerb,
}: {
  args: GithubReviewStateArgs;
  deps: GithubReviewStateDeps;
  repositoryResolutionVerb: RepositoryResolutionVerb | undefined;
}): Promise<Result<ReviewStateRead>> {
  const api = deps.api({ home: args.home });
  const fleet = await readProvenSelection({ api, args, deps, verb: repositoryResolutionVerb });
  if (fleet.isErr()) {
    return err(fleet.error);
  }
  const home = resolveHome({ named: args.home });
  const settled = await settleMergeable({ deps, home: args.home, prs: fleet.value.prs });
  const completed = await completeTruncatedChecks({
    concurrency: CHECK_COMPLETION_CONCURRENCY,
    deps: { fetchChecks: deps.checksCompletion({ home: args.home }), onProblem: deps.writeDiagnostic },
    prs: settled,
    totalLimit: DECISION_CHECK_LIMIT,
  });
  const distanced = await addBaseDistance({ args, baseDistances: deps.baseDistances, prs: completed });
  if (distanced.isErr()) {
    return err(githubVerbErrorLines({ error: distanced.error }));
  }
  const prs = distanced.value;
  const codeowners = await readCodeowners({ api, onProblem: deps.writeDiagnostic, slugs: repoSlugsOf({ prs }) });
  const { grouped, coverage } = await gatherSlack({ deps, home, liveHome: args.home, prs, slackLive: args.slackLive });
  const roster = await deps.roster({ home });
  if (roster.isErr()) {
    return err([roster.error.message]);
  }
  const nowIso = deps.now().toISOString();
  const places = stackPlaces({ pullRequests: prs });
  const sets = await readRequiredSets({ deps, home: args.home, prs });
  return ok({
    coverage,
    roster: roster.value,
    states: prs.map((pr) =>
      assembleReviewState({
        codeowners: codeowners.get(pr.repoSlug),
        conflictPaths: conflictPathsFor({ deps, home, pr }),
        coverage,
        mentions: mentionsFor({ grouped, pr }),
        nowIso,
        pr,
        requiredContexts: gateFor({ pr, sets }),
        roster: roster.value,
        stack: places.get(stackKey(pr))!, // `stackPlaces` placed every one of these `prs`
        threadBodiesRead: args.detail,
      }),
    ),
    total: fleet.value.total,
  });
}

/**
 * The local merge-tree measurement for one pull request, made only when GitHub reports it CONFLICTING.
 *
 * @param deps the injected edges, for the checkout read
 * @param home the state home holding the declared checkouts
 * @param pr the live pull-request state
 * @returns what the measurement found, or undefined when there was no conflict to measure
 */
function conflictPathsFor({
  deps,
  home,
  pr,
}: {
  deps: GithubReviewStateDeps;
  home: string;
  pr: PrLiveState;
}): ConflictPathsRead | undefined {
  if (pr.mergeable !== "CONFLICTING") {
    return undefined;
  }
  return deps.conflictPaths({
    baseRefName: pr.baseRefName,
    headOid: pr.headOid,
    home,
    number: pr.number,
    repoSlug: pr.repoSlug,
  });
}

/**
 * Run one `github review-state` invocation against injected edges.
 *
 * @param rest argv after `github review-state`
 * @param deps the repo-resolution, GitHub, Slack, corpus, roster, clock and output seams
 * @returns the process exit code
 */
export async function runGithubReviewState({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubReviewStateDeps;
}): Promise<number> {
  const parsed = parseGithubReviewStateArgs({ rest });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      deps.writeDiagnostic(problem);
    }
    deps.writeDiagnostic(githubReviewStateUsage());
    return EXIT_USAGE;
  }
  const args = parsed.value;
  const read = await collectReviewStates({ args, deps, repositoryResolutionVerb: "github review-state" });
  if (read.isErr()) {
    for (const problem of read.error) {
      deps.writeDiagnostic(problem);
    }
    return EXIT_ERROR;
  }
  const { states, coverage, roster, total } = read.value;
  report({ args, coverage, deps, limit: args.limit, roster, states, total });
  return EXIT_OK;
}

/** Print the table (or the JSON document) the run produced. */
function report({
  args,
  states,
  coverage,
  roster,
  deps,
  total,
  limit,
}: {
  args: GithubReviewStateArgs;
  states: readonly PrReviewState[];
  coverage: SlackCoverage;
  roster: ReviewRoster;
  deps: GithubReviewStateDeps;
  total: number;
  limit: number;
}): void {
  const lines = baseResidue({ coverage, limit, total });
  if (args.json) {
    deps.writeOut(JSON.stringify(reviewStateDocument({ coverage, residue: lines, roster, states }), undefined, 2));
    return;
  }
  deps.writeOut(REVIEW_STATE_HEADER);
  for (const state of states) {
    deps.writeOut(reviewStateRow({ state }));
  }
  deps.writeOut("");
  deps.writeOut(`${String(states.length)} of ${String(total)} open · ${recommendationTally({ states })}`);
  // The block comes AFTER the table, never instead of it: the verdict row is what a reader scans to pick
  // which pull request to look at, and the block is what they read once they have.
  if (args.detail) {
    for (const state of states) {
      deps.writeOut("");
      for (const line of reviewStateDetailBlock({ state })) {
        deps.writeOut(line);
      }
    }
  }
  for (const line of lines) {
    deps.writeDiagnostic(line);
  }
}

/**
 * Production edges: the same live GraphQL seam `github read` uses, the owner's Slack user token, the local
 * corpus and the derived roster.
 *
 * @returns the credential-aware GitHub, Slack, corpus, roster, clock and output seams
 */
export function productionGithubReviewStateDeps(): GithubReviewStateDeps {
  return {
    ...productionSlackLegDeps(),
    api: ({ home }) =>
      makeGithubReviewStateApi({
        graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }),
      }),
    checksCompletion: ({ home }) =>
      makeFetchGithubChecks({ graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }) }),
    conflictPaths: (args) => measureConflictingPaths(args),
    baseDistances: ({ home }) =>
      makeBaseDistanceRead({ graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }) }),
    mergeableRecheck: ({ home }) =>
      makeMergeableRecheck({ graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }) }),
    monotonicMs: () => performance.now(),
    pageDeadline: ({ ms, signal }) => delay(ms, undefined, { signal }),
    now: () => new Date(),
    requiredContexts: async ({ home, owner, repo, branch }) => {
      const token = githubToken(home === undefined ? {} : { home });
      const reads = makeGithubMergeQueueReads({
        graphql: githubReadGraphql({ token }),
        rest: githubReadRest({ token }),
      });
      const answered = await reads.requiredContexts({ branch, owner, repo });
      return answered.isErr() ? err(answered.error) : ok(answered.value.contexts);
    },
    resolveRepo: ({ explicit }) =>
      explicit !== undefined ? parseRepositorySlug({ slug: explicit }) : resolveRepository(),
    resolveRepository: ({ repoSlug, home }) =>
      resolveGithubRepository({
        graphql: githubReadGraphql({ token: githubToken(home === undefined ? {} : { home }) }),
        repoSlug,
      }),
    roster: liveReviewRoster,
    writeDiagnostic: (line) => {
      logger.warn({ msg: line });
    },
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/** `slopweaver github review-state`. */
export const githubReviewStateCommand = defineCommand({
  run: (argv) => runGithubReviewState({ deps: productionGithubReviewStateDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
