/**
 * The effectful half of `handover park`'s own-landing refusal. A `--wake-on-checks` takes one head read of the pull
 * request it names, and the run's branches, handed to `../../../handover/ownLandingPark.ts`'s pure judge. A
 * `--wake-at` asks `session close-done`'s own question through close-done's own read — every pull request on the
 * run's branches (`../hand/rowPullRequestsRead.ts`), judged by `../../../sessions/parkSeat.ts`'s
 * `ownPullRequestKeep` — so the seat's own clock park and the sweep cannot disagree about the same seat.
 * `./parkRun.ts` runs it before anything touches cmux, so a refused park closes nothing and journals nothing.
 *
 * The clock read's residue is close-done's: it knows the run's branches as the doc's `branch:`, the branch its
 * journal recorded at `start`, and the slug, never the worktree's current branch, so a seat that moved onto a branch
 * none of those name is not seen landing it.
 */

import { currentBranch } from "../../../codex/gitDiff.js";
import { githubToken } from "../../../config.js";
import type { RowPullRequests } from "../../../hand/rowPullRequest.js";
import { checksParkRefusalDetail, clockParkRefusalDetail, judgeChecksPark } from "../../../handover/ownLandingPark.js";
import type { ParkWake } from "../../../handover/parkWake.js";
import { hatchFor } from "../../../hatch/lookup.js";
import { hatchRefusalLines } from "../../../hatch/render.js";
import { hatchEnvVar } from "../../../hatch/types.js";
import type { IngestError } from "../../../lib/ingestError.js";
import { err, type Result } from "../../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import { makeFetchPrHead, type PrHead } from "../../../live/github/prHead.js";
import { githubReadGraphql } from "../../../live/github/read.js";
import { ownPullRequestKeep } from "../../../sessions/parkSeat.js";
import { readRowPullRequests } from "../hand/rowPullRequestsRead.js";

/** The hatch past the refusal; its key is `SLOPWEAVER_ALLOW_PARK_OWN_LANDING`, read below. */
const PARK_OWN_LANDING_HATCH = hatchFor({ id: "park-own-landing" });

/** The reads the gate makes, injectable so a test drives every verdict without GitHub or git. */
export interface ParkOwnLandingDeps {
  readonly readPrHead: (args: { repo: string; number: number }) => Promise<Result<PrHead, GithubLiveError>>;
  readonly readBranch: (args: { cwd: string }) => Result<string | null, IngestError>;
  readonly readOwnPullRequests: (args: { slug: string }) => Promise<RowPullRequests>;
}

/**
 * The production reads: one GraphQL head read through the provider door, `git branch --show-current`, and the row's
 * pull requests through the same reader `session close-done` keeps a seat on.
 *
 * @param home the state home whose GitHub token the read uses
 * @returns the deps the gate reads through
 */
export function productionParkOwnLandingDeps({ home }: { home: string }): ParkOwnLandingDeps {
  return {
    readBranch: ({ cwd }) => currentBranch({ cwd }),
    // The token resolves only when a wake reads GitHub, so a question park or an open hatch never
    // waits on `gh auth token`.
    readOwnPullRequests: ({ slug }) =>
      readRowPullRequests({ graphql: githubReadGraphql({ token: githubToken({ home }) }), home, row: slug }),
    readPrHead: ({ repo, number }) => {
      const fetchHead = makeFetchPrHead({ graphql: githubReadGraphql({ token: githubToken({ home }) }) });
      const slash = repo.indexOf("/");
      return fetchHead({ number, owner: repo.slice(0, slash), repo: repo.slice(slash + 1) });
    },
  };
}

/**
 * The refusal lines for a park that would close a seat while its run's own pull request is open, or none when the
 * park may proceed.
 *
 * @param env the environment the hatch is read from
 * @param recordedBranch the branch the run recorded at `start`
 * @param runTree the worktree the run recorded for its seat, whose current branch is read too
 * @param seatTree the directory the park runs in, whose current branch is read as well
 * @param slug the run's row, whose pull requests a clock wake reads
 * @param wake the wake the park names; a question-only park reads nothing
 * @returns the four-line refusal, or an empty list when the park may proceed
 */
export async function ownLandingRefusal({
  deps,
  env,
  recordedBranch,
  runTree,
  seatTree,
  slug,
  wake,
}: {
  deps: ParkOwnLandingDeps;
  env: NodeJS.ProcessEnv;
  recordedBranch: string | undefined;
  runTree: string | undefined;
  seatTree: string;
  slug: string;
  wake: ParkWake | undefined;
}): Promise<readonly string[]> {
  if (wake === undefined) {
    return [];
  }
  // `SLOPWEAVER_ALLOW_PARK_OWN_LANDING`, the `park-own-landing` row's key, spelled for `escape-hatch`.
  if (env[hatchEnvVar({ suffix: "PARK_OWN_LANDING" })] === "1") {
    return [];
  }
  if (wake.kind === "at") {
    return clockParkRefusal({ deps, slug });
  }
  // The worktree's branch is read on BOTH sides of the head read, so a checkout switched while that
  // read was in flight still leaves the branch the seat had out in the set the head is compared with.
  const before = runBranchesOf({ deps, recordedBranch, runTree, seatTree });
  // `.then` turns a synchronous throw from the seam into a rejection, so both reach the `.catch`.
  const head: Result<PrHead, GithubLiveError> = await Promise.resolve()
    .then(() => deps.readPrHead({ number: wake.number, repo: wake.repo }))
    .catch((cause: unknown) =>
      // Never `String()` an arbitrary thrown value — its conversion can itself throw.
      err(GithubLiveErrors.readFailed({ cause, message: `the head read threw: ${thrownMessage({ cause })}` })),
    );
  const after = runBranchesOf({ deps, recordedBranch, runTree, seatTree });
  const branches = [...new Set([...before.branches, ...after.branches])];
  const branchUnread = mergedUnread({ after, before });
  const judgement = judgeChecksPark({ branchUnread, head, runBranches: branches, wake });
  if (judgement.kind === "may-park") {
    return [];
  }
  return hatchRefusalLines({ detail: checksParkRefusalDetail({ judgement }), hatch: PARK_OWN_LANDING_HATCH });
}

/**
 * The refusal for a clock park while the run's own pull request is open, or its pull requests did not read — one
 * read, whose answer both decides and is quoted. A read that throws is UNREAD, never "no pull request".
 */
async function clockParkRefusal({
  deps,
  slug,
}: {
  deps: ParkOwnLandingDeps;
  slug: string;
}): Promise<readonly string[]> {
  // `.then` turns a synchronous throw from the seam into a rejection, so both reach the `.catch`.
  const answer: RowPullRequests = await Promise.resolve()
    .then(() => deps.readOwnPullRequests({ slug }))
    .catch((cause: unknown): RowPullRequests => ({
      kind: "unread",
      why: `the own pull request read threw: ${thrownMessage({ cause })}`,
    }));
  const keep = ownPullRequestKeep({ answer });
  if (keep === undefined) {
    return [];
  }
  return hatchRefusalLines({ detail: clockParkRefusalDetail({ why: keep.why }), hatch: PARK_OWN_LANDING_HATCH });
}

/**
 * Why the worktree's branch is unknown across the two reads that bracket the head read, if it is: either read
 * failing, or the two disagreeing — a checkout moved while the head was read, so the branch the head saw may be
 * one neither read caught.
 */
function mergedUnread({ before, after }: { before: RunBranchesRead; after: RunBranchesRead }): string | undefined {
  if (before.branchUnread !== undefined) {
    return before.branchUnread;
  }
  if (after.branchUnread !== undefined) {
    return after.branchUnread;
  }
  if (before.current.join("\n") !== after.current.join("\n")) {
    return "the worktree changed branch while the head was read, so the branch it had out then is unknown";
  }
  return undefined;
}

/**
 * A thrown value's message, read without converting a non-`Error` value, whose conversion may itself throw — and
 * without trusting an `Error`'s own `message`, which a getter can make throw too.
 */
function thrownMessage({ cause }: { cause: unknown }): string {
  // Even `instanceof` runs a Proxy's `getPrototypeOf` trap, so the whole read sits inside the try.
  try {
    if (!(cause instanceof Error)) {
      return "a value that is not an Error";
    }
    const { message } = cause;
    if (typeof message === "string") {
      return message;
    }
    return "an Error whose message is not a string";
  } catch {
    return "a value whose message would not read";
  }
}

/** One read of the branches a run may own: every branch named, the current ones alone, and why any is unknown. */
interface RunBranchesRead {
  readonly branches: readonly string[];
  readonly current: readonly string[];
  readonly branchUnread: string | undefined;
}

/**
 * The branches a run may own — the one it started on, the one its recorded worktree has out now, and the one the
 * directory the park runs in has out (a seat that moved into another worktree is landing THAT
 * branch) — and, when either worktree's branch is unknown (no worktree recorded, a read FAILED, or a HEAD detached
 * as a rebase leaves it), why: that branch may be exactly the head, so the judge must not read it as absent.
 */
function runBranchesOf({
  deps,
  recordedBranch,
  runTree,
  seatTree,
}: {
  deps: ParkOwnLandingDeps;
  recordedBranch: string | undefined;
  runTree: string | undefined;
  seatTree: string;
}): RunBranchesRead {
  const reasons: string[] = [];
  if (runTree === undefined) {
    // With no worktree recorded, the branch the run has out now is as unknown as a failed read.
    reasons.push("this run records no worktree to read its current branch from");
  }
  const trees = runTree === undefined || runTree === seatTree ? [seatTree] : [runTree, seatTree];
  const current: string[] = [];
  for (const cwd of trees) {
    const read = deps.readBranch({ cwd });
    if (read.isErr()) {
      reasons.push(`the branch at ${cwd} did not read: ${read.error.message}`);
    } else if (read.value === null) {
      // A detached HEAD is what a rebase looks like mid-way, so the branch being landed is unknown.
      reasons.push(`${cwd} is detached, as it is mid-rebase, so its branch is unknown`);
    } else {
      current.push(read.value);
    }
  }
  const recorded = recordedBranch === undefined ? [] : [recordedBranch];
  return { branchUnread: reasons.at(0), branches: [...recorded, ...current], current };
}
