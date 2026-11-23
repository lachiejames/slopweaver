/**
 * The shared seams every `checks/` test drives `slopweaver github checks` through.
 *
 * Plain functions passed in, never mocks: a fake clock that advances only when slept, a checks and activity
 * read that serves its fixtures in turn and repeats the last, and witness arrays the caller owns. It moved
 * here when `checks.test.ts` was split by behaviour; it is deterministic and touches no disk or network, but
 * it is stateful — each `depsFor` advances its own read cursors.
 */
import { err, ok } from "#lib/result.js";
import type { GithubChecksDeps } from "../../../../../../cli/commands/github/checksSeams.js";
import type { GithubChecksSnapshot } from "../../../../../../live/github/checks.js";
import { GithubJobLogErrors } from "../../../../../../live/github/jobLogErrors.js";
import type { GithubPrActivity } from "../../../../../../live/github/prEvents.js";

/** The repository every fake resolves to. */
export const REPO = { owner: "acme", repo: "widget" };

/**
 * A checks snapshot on head `abc123` against `main`, rollup still PENDING.
 *
 * @returns the snapshot carrying the given checks and nothing superseded or truncated
 */
export function snapshot({
  checks = [],
}: {
  checks?: GithubChecksSnapshot["checks"];
} = {}): GithubChecksSnapshot {
  return {
    baseRef: "main",
    checks,
    headSha: "abc123",
    mergeable: undefined,
    residue: [],
    rollupState: "PENDING",
    supersededChecks: [],
    truncated: false,
  };
}

/** A check run that passed. */
export const PASSED_CHECK = { kind: "check-run" as const, name: "lint", state: "passed" as const, url: undefined };
/** A check run still running. */
export const RUNNING_CHECK = { kind: "check-run" as const, name: "build", state: "running" as const, url: undefined };
/** A check run that failed. */
export const FAILED_CHECK = { kind: "check-run" as const, name: "test", state: "failed" as const, url: undefined };

/** A deterministic fake clock: `sleep` advances it by exactly the requested amount, no real timer. */
function fakeClock(): { readonly now: () => Date; readonly sleep: (args: { ms: number }) => Promise<void> } {
  let elapsedMs = 0;
  return {
    now: () => new Date(elapsedMs),
    sleep: ({ ms }) => {
      elapsedMs += ms;
      return Promise.resolve();
    },
  };
}

/** One watch row as the harness sees it: the fields the fold reads, without the clock or the session. */
export type WatchWitness =
  | { kind: "watching"; number: number; headSha: string; mode: string; timeoutSeconds: number }
  | { kind: "watch-done"; number: number; headSha: string; outcome: string };

/**
 * A quiet, open pull request as the activity leg sees it.
 *
 * @returns the activity, viewed by `me`, with no merge instant
 */
export function activity({
  headSha = "abc123",
  reviews = [],
  comments = [],
  state = "OPEN",
}: {
  headSha?: GithubPrActivity["headSha"];
  reviews?: GithubPrActivity["reviews"];
  comments?: GithubPrActivity["comments"];
  state?: GithubPrActivity["state"];
} = {}): GithubPrActivity {
  return { comments, headSha, mergedAt: undefined, reviews, state, viewer: "me" };
}

/**
 * Every seam `runGithubChecks` calls, each read served from the fixtures in turn (the last one repeating) and
 * each record appended to the caller's witness arrays.
 *
 * @returns the deps, on a fresh fake clock, resolving every repository to `REPO`
 */
export function depsFor({
  out,
  diagnostic,
  fetches,
  activities = [activity()],
  required = [],
  reads = [],
  watches = [],
  readJobLogs = () => Promise.resolve(err(GithubJobLogErrors.runNotFound({ runId: 0 }))),
  logReads = [],
}: {
  out: string[];
  diagnostic: string[];
  fetches: readonly GithubChecksSnapshot[];
  activities?: readonly GithubPrActivity[];
  required?: readonly string[];
  /** Every checks-read the shell recorded, in order — the witness for the once-per-invocation rule. */
  reads?: { repo: string; number: number; headSha: string; rollup: string }[];
  /** Every watch row the shell recorded, in order — the witness for the watched column's two rows. */
  watches?: WatchWitness[];
  readJobLogs?: GithubChecksDeps["readJobLogs"];
  /** Every job-log read `--log` asked for, in order — the witness for the run grouping. */
  logReads?: { runId: number; jobIds: readonly number[]; lines: number }[];
}): GithubChecksDeps {
  let call = 0;
  let activityCall = 0;
  const clock = fakeClock();
  return {
    ...clock,
    fetchActivity: () => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- the fake repeats its last activity fixture, and the default is non-empty; a guard would change what an empty list serves
      const next = activities[Math.min(activityCall, activities.length - 1)]!;
      activityCall += 1;
      return Promise.resolve(ok(next));
    },
    fetchChecks: () => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- a caller passing no snapshot replaces fetchChecks before it runs; a guard would change what an empty list serves
      const next = fetches[Math.min(call, fetches.length - 1)]!;
      call += 1;
      return Promise.resolve(ok(next));
    },
    fetchRequiredContexts: ({ branch }) =>
      Promise.resolve(ok({ branch, contexts: required, requiresCodeOwnerReviews: undefined })),
    readJobLogs: (args) => {
      logReads.push({ jobIds: args.jobIds, lines: args.lines, runId: args.runId });
      return readJobLogs(args);
    },
    recordChecksRead: ({ repo, number, headSha, rollup }) => reads.push({ headSha, number, repo, rollup }),
    recordWatchDone: ({ number, headSha, outcome }) => watches.push({ headSha, kind: "watch-done", number, outcome }),
    recordWatching: ({ number, headSha, mode, timeoutSeconds }) =>
      watches.push({ headSha, kind: "watching", mode, number, timeoutSeconds }),
    resolveRepo: () => ok(REPO),
    writeDiagnostic: (line) => diagnostic.push(line),
    writeOut: (line) => out.push(line),
  };
}
