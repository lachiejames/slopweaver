/**
 * The review-state SELECTION read: every open pull request the query matches, paged and halved under one
 * wall-clock budget, or the ONE pull request `--number` names.
 *
 * ## Why the fleet read carries a budget
 *
 * `slopweaver supervisor tick close` refreshes the owner's list by running `session-start --json --no-record` as a child
 * under a 420-second budget (`../supervisor/scratchRefresh.ts`), and a killed child leaves NOTHING — the page
 * renders the seat's older list until the stale-snapshot gate refuses it. MEASURED over the chair's closes,
 * 9 of 57 lost that refresh, every one `timed out after 420s (killed)`, and the one captured
 * stderr was a single halving line from this read. Reproduce the count:
 *
 * ```sh
 * grep -rh "list was not refreshed" "$SLOPWEAVER_HOME/supervisor-scratch" | wc -l
 * ```
 *
 * A HEALTHY fleet read of the owner's 46 pull requests over both repositories is 20-28s, with a page of twenty taking
 * 7.5-11.3s — on GitHub's own ~10s GraphQL timeout, which is where the 502 and 504 answers at ~11s come from
 * (measured at load average 17-43, by timing `makeGithubReviewStateApi().fleetPage` in a loop). What
 * made a declined page catastrophic was the client beneath it: Octokit's retry plugin re-sent every 5xx three
 * times with 1s/4s/9s backoff, so one declined page cost up to ~58s before this loop even saw it and halved,
 * and there was no request timeout at all, so a stalled socket held a page until undici's own 300s. A whole
 * `session-start` already spends ~311s when nothing fails, so two declined pages were enough.
 *
 * So a fleet page switches off the client's retries (halving IS the retry, see {@link readSelection}), each
 * request is aborted at {@link FLEET_PAGE_TIMEOUT_MS} or at the budget's remaining time, whichever is sooner,
 * and the whole read ends BY NAME past {@link FLEET_READ_BUDGET_MS}. It never returns the pages it did read: a
 * partial fleet would print the `--limit` residue "raise --limit to see the rest", which would be false.
 * `session-start` degrades a failed GitHub leg into a `could not see` line and still refreshes the rest of the owner's
 * list; `github landing` and the vulnerability-fix roster fail the invocation, as they did on an exhausted halving before.
 *
 * The trade, named rather than hidden: a genuinely transient failure on a page of ONE now gets one attempt,
 * not four. Halving re-asks at a cheaper size, which is not the same request, and a rate limit is not halved
 * at all, because a smaller page does not repair an exhausted quota.
 */

import { err, ok, type Result } from "#lib/result.js";

import { type GithubLiveError, GithubLiveErrors } from "../../../live/github/errors.js";
import type { GithubReviewStateApi, PrLiveState } from "../../../live/github/reviewState.js";
import type { GithubReviewStateArgs } from "./reviewStateCore.js";

/**
 * The whole fleet read's wall-clock budget: ~3.6x the 25s a healthy read of the owner's 46 pull requests measured,
 * and room for one declined page of twenty plus the rest of the read at ten. See the header for the command.
 */
const FLEET_READ_BUDGET_MS = 90_000;

/**
 * The longest one fleet request may run: 2.7x the slowest page of twenty measured (11.3s). GitHub answers or
 * declines inside ~11s, so a request still open at thirty seconds is a stall, not a slow answer.
 */
const FLEET_PAGE_TIMEOUT_MS = 30_000;

/** The pull requests kept, and how many GitHub said matched in total. */
export interface FleetRead {
  readonly prs: readonly PrLiveState[];
  readonly total: number;
  /** The repository of EVERY row GitHub returned, the ones `--limit` dropped from `prs` included. */
  readonly rowRepos: readonly string[];
}

/** The fleet read ran past its wall-clock budget, and so ended without a result rather than with part of one. */
interface FleetBudgetExceededError {
  readonly code: "FLEET_BUDGET_EXCEEDED";
  readonly message: string;
  readonly budgetMs: number;
  readonly elapsedMs: number;
  readonly pageSize: number;
  readonly read: number;
}

/** Why the selection could not be read: a page GitHub refused for good, or the budget spent. */
type FleetReadError = GithubLiveError | FleetBudgetExceededError;

/** The factory for {@link FleetBudgetExceededError}, the one failure this module adds to a GitHub read's own. */
const FleetReadErrors = {
  budgetExceeded: ({
    elapsedMs,
    pageSize,
    read,
    total,
    lastPageMessage,
  }: {
    elapsedMs: number;
    pageSize: number;
    read: number;
    /** What GitHub said matched, or undefined when no page had answered yet. */
    total: number | undefined;
    /** The last page's failure, or undefined when every page so far had answered. */
    lastPageMessage: string | undefined;
  }): FleetBudgetExceededError => {
    const progress = total === undefined ? "before any page answered" : `with ${String(read)} of ${String(total)} read`;
    let last = "no page had failed before the budget ran out";
    if (lastPageMessage !== undefined) {
      last = lastPageMessage;
    }
    return {
      budgetMs: FLEET_READ_BUDGET_MS,
      code: "FLEET_BUDGET_EXCEEDED",
      elapsedMs,
      message: `the fleet read stopped after ${String(Math.floor(elapsedMs / 1000))}s, past its ${String(FLEET_READ_BUDGET_MS / 1000)}s budget, at a page of ${String(pageSize)} pull requests ${progress}: ${last}`,
      pageSize,
      read,
    };
  },
} as const;

/**
 * A timer that resolves after `ms`, and stops early when `signal` aborts. Injected so a test can make a page's
 * deadline pass without waiting thirty real seconds.
 */
export type PageDeadline = (args: { ms: number; signal: AbortSignal }) => Promise<void>;

/** One fleet page's answer. */
type FleetPageAnswer = Awaited<ReturnType<GithubReviewStateApi["fleetPage"]>>;

/** Where one fleet read has got to — everything a budget failure has to name. */
interface FleetProgress {
  readonly prs: PrLiveState[];
  cursor: string | undefined;
  total: number | undefined;
  pageSize: number;
  lastPageMessage: string | undefined;
}

/**
 * Read the selection an invocation names: the one pull request `--number` gives, or the whole fleet.
 *
 * @param api the live read seam
 * @param args the parsed invocation, carrying the page size, the limits and any `--number`
 * @param query the search query every fleet page is read with
 * @param deps the monotonic clock the budget is measured on, so a wall-clock step moves no deadline, and where a
 * halving or an exhausted halving is reported
 * @returns the pull requests read, or why none are returned
 */
export async function readSelection({
  api,
  args,
  query,
  deps,
}: {
  api: GithubReviewStateApi;
  args: GithubReviewStateArgs;
  query: string;
  deps: {
    readonly monotonicMs: () => number;
    readonly pageDeadline: PageDeadline;
    readonly writeDiagnostic: (line: string) => void;
  };
}): Promise<Result<FleetRead, FleetReadError>> {
  if (args.number !== undefined) {
    return readOnePr({ api, args });
  }
  const { monotonicMs, pageDeadline, writeDiagnostic } = deps;
  return readFleet({ api, args, monotonicMs, onProblem: writeDiagnostic, pageDeadline, query });
}

/**
 * Page the fleet read until `--limit` or the last page, whichever comes first, halving the page whenever
 * GitHub will not answer one, and ending by name once the budget is spent.
 *
 * ## Why a failed page is halved rather than ending the read
 *
 * The fleet query is the biggest request this verb makes — twenty pull requests, each with its files,
 * labels, review requests, reviews, review threads with comment bodies and the head's whole check rollup —
 * and `../../../live/github/reviewState.ts`'s own header already names the page as the lever the expensive
 * `statusCheckRollup` field leaves. MEASURED: `slopweaver github landing --repo acme/acme-admin
 * --author octocat --json` failed once in twenty-two consecutive runs with `GitHub returned no
 * search connection for the fleet read`, and two of the `vulnfix-topup-acme-admin` recipe's three attempts
 * lost that coin flip inside an hour. Reproduce by looping the command and reading stderr.
 *
 * This is the mechanism `../../../live/github/aliasedFleetRead.ts` states for the aliased reads — halve and
 * retry, recursing to one item. The reduced size is KEPT for the rest of the read: a fleet too heavy at twenty
 * is too heavy at twenty on its next page too. Each halving is reported through `onProblem`.
 *
 * ## The budget is checked on BOTH sides of a request
 *
 * Before one, so no request starts past the deadline, and each carries only the time that remains. After one,
 * so an answer that arrived at or past the deadline — timer jitter, a starved event loop — is refused rather
 * than accepted as if it were inside the budget. Both read a MONOTONIC clock, never the run's `Date`: a system
 * clock stepped back mid-request would otherwise make a page answered past the deadline read as timely.
 * The bound is the budget PLUS scheduling jitter, never exactly the budget: a process descheduled between the
 * check and the send can dispatch a page a millisecond late, which its own signal then aborts and whose answer
 * the second check refuses. No check-then-send closes that gap, and it is milliseconds against 420s.
 * A page is refused as `RATE_LIMITED` before it is sent while the shared GitHub rate block is closed, rather than
 * waiting, possibly minutes, inside the provider door (`refuseWhileBlocked`).
 *
 * @returns the pull requests read, or the failure that ended the read
 */
async function readFleet({
  api,
  args,
  query,
  monotonicMs,
  onProblem,
  pageDeadline,
}: {
  api: GithubReviewStateApi;
  args: GithubReviewStateArgs;
  query: string;
  monotonicMs: () => number;
  onProblem: (line: string) => void;
  pageDeadline: PageDeadline;
}): Promise<Result<FleetRead, FleetReadError>> {
  const startedAtMs = monotonicMs();
  const progress: FleetProgress = {
    cursor: undefined,
    lastPageMessage: undefined,
    pageSize: args.pageSize,
    prs: [],
    total: undefined,
  };
  for (;;) {
    // Whole milliseconds: the monotonic clock is fractional, and `AbortSignal.timeout` refuses a fraction.
    const remainingMs = Math.floor(FLEET_READ_BUDGET_MS - (monotonicMs() - startedAtMs));
    if (remainingMs <= 0) {
      return err(budgetSpent({ monotonicMs, progress, startedAtMs }));
    }
    const page = await sendPage({
      api,
      args,
      pageDeadline,
      progress,
      query,
      timeoutMs: Math.min(FLEET_PAGE_TIMEOUT_MS, remainingMs),
    });
    if (monotonicMs() - startedAtMs >= FLEET_READ_BUDGET_MS) {
      return err(budgetSpent({ monotonicMs, progress, startedAtMs }));
    }
    const ended = takePage({ limit: args.limit, onProblem, page, progress });
    if (ended !== undefined) {
      return ended;
    }
  }
}

/**
 * Send the next fleet page at the read's current cursor and size, recording its failure for the budget message.
 *
 * @param timeoutMs how long the page has, already capped at the fleet budget that remains
 * @returns the page's answer, or the failure that ended it
 */
async function sendPage({
  api,
  args,
  pageDeadline,
  progress,
  query,
  timeoutMs,
}: {
  api: GithubReviewStateApi;
  args: GithubReviewStateArgs;
  pageDeadline: PageDeadline;
  progress: FleetProgress;
  query: string;
  timeoutMs: number;
}): Promise<FleetPageAnswer> {
  const page = await pageWithin({
    ms: timeoutMs,
    page: () =>
      api.fleetPage({
        checkLimit: args.checkLimit,
        cursor: progress.cursor,
        fileLimit: args.fileLimit,
        pageSize: progress.pageSize,
        query,
        timeoutMs,
        withBodies: args.detail,
      }),
    pageDeadline,
  });
  if (page.isErr()) {
    progress.lastPageMessage = page.error.message;
  }
  return page;
}

/**
 * Fold one in-budget page into the read: halve on a failure, else keep its pull requests and move the cursor.
 *
 * @param limit the most pull requests the read returns
 * @returns the read's end — every pull request, or the failure halving could not survive — or undefined to go on
 */
function takePage({
  limit,
  onProblem,
  page,
  progress,
}: {
  limit: number;
  onProblem: (line: string) => void;
  page: FleetPageAnswer;
  progress: FleetProgress;
}): Result<FleetRead, FleetReadError> | undefined {
  if (page.isErr()) {
    const refused = halveOrEnd({ error: page.error, onProblem, progress });
    return refused === undefined ? undefined : err(refused);
  }
  progress.total = page.value.totalCount;
  progress.prs.push(...page.value.pullRequests);
  progress.cursor = page.value.nextCursor;
  if (progress.cursor === undefined || progress.prs.length >= limit) {
    const rowRepos = progress.prs.map((pr) => pr.repoSlug);
    return ok({ prs: progress.prs.slice(0, limit), rowRepos, total: progress.total });
  }
  return undefined;
}

/**
 * One fleet page, or a failed page once `ms` passes without an answer, whatever the request is waiting in.
 *
 * The page's own abort signal reaches only `fetch`. Octokit's throttle queue serialises every GraphQL call before
 * `fetch`, and the provider door waits on the shared rate block before that, so neither is bounded by it . This outer race bounds all of them. The abandoned request stays harmless: its signal aborts the `fetch` it
 * eventually reaches, and nothing reads its answer.
 *
 * @param page starts the request, called only once the timer is armed, so no part of the call runs untimed
 * @param ms how long it has, the same timeout its own signal carries
 * @param pageDeadline the timer the race runs against
 * @returns the page's answer, or a read failure naming the timeout
 */
async function pageWithin({
  page,
  ms,
  pageDeadline,
}: {
  page: () => Promise<FleetPageAnswer>;
  ms: number;
  pageDeadline: PageDeadline;
}): Promise<FleetPageAnswer> {
  const cancel = new AbortController();
  const timedOut = pageDeadline({ ms, signal: cancel.signal }).then((): FleetPageAnswer =>
    err(GithubLiveErrors.readFailed({ message: `the fleet page did not answer within ${String(ms)}ms` })),
  );
  try {
    return await Promise.race([page(), timedOut]);
  } finally {
    cancel.abort();
  }
}

/**
 * The budget failure for where the read has got to.
 *
 * @returns the named failure, measured against the same clock the loop read
 */
function budgetSpent({
  monotonicMs,
  progress,
  startedAtMs,
}: {
  monotonicMs: () => number;
  progress: FleetProgress;
  startedAtMs: number;
}): FleetBudgetExceededError {
  return FleetReadErrors.budgetExceeded({
    elapsedMs: monotonicMs() - startedAtMs,
    lastPageMessage: progress.lastPageMessage,
    pageSize: progress.pageSize,
    read: progress.prs.length,
    total: progress.total,
  });
}

/**
 * Halve the page after a failed one, or say why the read ends here.
 *
 * A rate limit ends it at once: a smaller page does not repair an exhausted quota, and re-asking would only
 * spend more of it. A page of ONE that still fails ends it too, with GitHub's own message.
 *
 * @param error what the failed page answered
 * @param onProblem where the halving, or the exhausted halving, is reported
 * @param progress the read's state, whose page size this halves
 * @returns undefined when the read should go on at the halved size, else the failure that ends it
 */
function halveOrEnd({
  error,
  onProblem,
  progress,
}: {
  error: GithubLiveError;
  onProblem: (line: string) => void;
  progress: FleetProgress;
}): GithubLiveError | undefined {
  if (error.code === "RATE_LIMITED") {
    onProblem(`the fleet read hit GitHub's rate limit, which a smaller page cannot help: ${error.message}`);
    return error;
  }
  if (progress.pageSize <= 1) {
    onProblem(
      `the fleet read failed at a page of ONE pull request, so no smaller request is left to try: ${error.message}`,
    );
    return error;
  }
  const halved = Math.max(1, Math.floor(progress.pageSize / 2));
  onProblem(
    `the fleet read failed at a page of ${String(progress.pageSize)} pull requests and is retrying at ${String(halved)}: ${error.message}`,
  );
  progress.pageSize = halved;
  return undefined;
}

/**
 * Read the ONE pull request `--number` names, through the same node selection the fleet pages.
 *
 * A single-pull-request read reports `total: 1` rather than the repository's open count, because the
 * selection IS one pull request — a total describing a set the caller did not ask for would make the
 * footer's "1 of 34 open" read as a truncation. It is outside the fleet budget: it neither pages nor halves.
 *
 * @param api the live read seam
 * @param args the parsed invocation, carrying the number and the single repo slug
 * @returns the one pull request, or the read failure
 */
async function readOnePr({
  api,
  args,
}: {
  api: GithubReviewStateApi;
  args: GithubReviewStateArgs;
}): Promise<Result<FleetRead, GithubLiveError>> {
  // Both assertions are the parser's contract rather than optimism: `parseGithubReviewStateArgs` refuses
  // `--number` unless exactly one `--repo <owner/name>` came with it, so a caller reaching here without both
  // is a parser defect that should fail loudly rather than read one repository as the empty string.
  const [owner, repo] = args.repos[0]!.split("/");
  const one = await api.pr({
    checkLimit: args.checkLimit,
    fileLimit: args.fileLimit,
    number: args.number!,
    owner: owner!,
    repo: repo!,
    withBodies: args.detail,
  });
  return one.isErr() ? err(one.error) : ok({ prs: [one.value], rowRepos: [one.value.repoSlug], total: 1 });
}
