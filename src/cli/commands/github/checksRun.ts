/** The effectful shell for `slopweaver github checks`. */

import {
  formatChecksLine,
  type GithubChecksSnapshot,
  type GithubChecksSummary,
  isChecksTerminal,
  nextChecksPollDelayMs,
  summarizeChecks,
} from "../../../live/github/checks.js";
import {
  type RequiredContextGate,
  requiredContextRefusal,
  withRequiredContextClause,
} from "../../../live/github/requiredContexts.js";
import type { ChecksWatchMode } from "../../../outbound/github/checksReadLedger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { type GithubChecksArgs, parseGithubChecksArgs } from "./checksCore.js";
import { makeRequiredGateReader, pollEvents } from "./checksEventWatch.js";
import { runChecksLog } from "./checksLogRun.js";
import { outlastFailedRead } from "./checksRateWait.js";
import { type RecordFirstRead, recordFirstRead, watchOutcome } from "./checksRegister.js";
import type { GithubChecksDeps, PollTarget } from "./checksSeams.js";
import { githubChecksUsage } from "./ciUsage.js";

const VERB_ARG_OFFSET = 4;

/** Write every line of a multi-problem `Result` error to the diagnostic channel. */
function writeProblems({ deps, problems }: { deps: GithubChecksDeps; problems: readonly string[] }): void {
  for (const problem of problems) {
    deps.writeDiagnostic(problem);
  }
}

/** Whether polling should stop: `--wait` was not given, every check is terminal, or the deadline would be missed. */
function isPollDone({
  wait,
  terminal,
  willTimeOut,
}: {
  wait: boolean;
  terminal: boolean;
  willTimeOut: boolean;
}): boolean {
  return !wait || terminal || willTimeOut;
}

/**
 * The final exit code: `EXIT_OK` only once every check is terminal, none failed, AND every context the base
 * branch requires is actually on the head.
 *
 * The last clause is the one GitHub's own rollup cannot supply. A required context that never ran is absent
 * rather than red, so a run without this clause exits `EXIT_OK` over a gate holding no verdict — the false
 * green a merge lap then reads as permission to land.
 *
 * `unproven` counts the same as `missing` here and differs only in what gets PRINTED. The exit code answers
 * "may this land", and a read that could not see the whole head has not established that any more than one
 * that saw the name absent — while the refusal beside it must still not claim the name never ran.
 */
function checksExitCode({
  terminal,
  summary,
  gate,
}: {
  terminal: boolean;
  summary: GithubChecksSummary;
  gate: RequiredContextGate;
}): number {
  const unsatisfiedRequired = gate.kind === "read" && (gate.missing.length > 0 || gate.unproven.length > 0);
  return terminal && summary.failed === 0 && !unsatisfiedRequired ? EXIT_OK : EXIT_EXPECTED_EMPTY;
}

/**
 * Report one poll's final outcome: one JSON document, or a timeout line when polling gave up early — and,
 * either way, the refusal a required context that never ran earns.
 *
 * The refusal is printed on the diagnostic channel beside the last status line rather than folded into it,
 * because it carries the remedy and the two causes have different ones. In `--json` the same fact is a
 * field, so a caller parsing the document never has to read prose to find it.
 */
function reportFinalOutcome({
  deps,
  snapshot,
  summary,
  terminal,
  timedOut,
  json,
  timeoutSeconds,
  gate,
}: {
  deps: GithubChecksDeps;
  snapshot: GithubChecksSnapshot;
  summary: GithubChecksSummary;
  terminal: boolean;
  timedOut: boolean;
  json: boolean;
  timeoutSeconds: number;
  gate: RequiredContextGate;
}): void {
  if (json) {
    deps.writeOut(JSON.stringify({ ...snapshot, gate, summary, terminal, timedOut }, undefined, 2));
    return;
  }
  if (timedOut) {
    deps.writeDiagnostic(`timed out after ${String(timeoutSeconds)}s waiting for checks to reach a terminal state`);
  }
  const refusal = requiredContextRefusal({ gate });
  if (refusal !== undefined) {
    deps.writeDiagnostic(`refused: ${refusal}`);
  }
}

/** The status-line loop: the original `--wait`, one compact line per poll, stopping on the CI verdict. */
async function pollStatusLines({
  deps,
  target,
  wait,
  json,
  recordRead,
}: {
  deps: GithubChecksDeps;
  target: PollTarget;
  wait: boolean;
  json: boolean;
  recordRead: RecordFirstRead;
}): Promise<number> {
  const { home, limit, number, owner, repo, deadlineMs, timeoutSeconds } = target;
  const readGate = makeRequiredGateReader({ deps, target });
  for (let attempt = 0; ; attempt += 1) {
    const fetched = await deps.fetchChecks({ home, limit, number, owner, repo });
    if (fetched.isErr()) {
      const stopped = await outlastFailedRead({ deps, error: fetched.error, events: false, target, wait });
      if (stopped !== undefined) {
        return stopped;
      }
      continue;
    }
    const snapshot = fetched.value;
    recordRead({ snapshot });
    const summary = summarizeChecks({ checks: snapshot.checks });
    const terminal = isChecksTerminal({ summary });
    const gate = await readGate({ snapshot });
    if (!json) {
      deps.writeOut(withRequiredContextClause({ gate, line: formatChecksLine({ snapshot, summary }) }));
    }
    const delayMs = nextChecksPollDelayMs({ attempt });
    const willTimeOut = deps.now().getTime() + delayMs > deadlineMs;
    if (isPollDone({ terminal, wait, willTimeOut })) {
      const timedOut = wait && !terminal && willTimeOut;
      reportFinalOutcome({ deps, gate, json, snapshot, summary, terminal, timedOut, timeoutSeconds });
      return checksExitCode({ gate, summary, terminal });
    }
    await deps.sleep({ ms: delayMs });
  }
}

/** Everything a poll or a log read needs about its subject, including the deadline read off the clock once. */
function pollTargetOf({
  args,
  deps,
  repository,
}: {
  args: GithubChecksArgs;
  deps: GithubChecksDeps;
  repository: { owner: string; repo: string };
}): PollTarget {
  return {
    deadlineMs: deps.now().getTime() + args.timeoutSeconds * 1000,
    home: args.home,
    limit: args.limit,
    number: args.number,
    owner: repository.owner,
    repo: repository.repo,
    timeoutSeconds: args.timeoutSeconds,
  };
}

/** Where an event watch starts reading: `--since` when given, else this moment, so only new events print. */
function eventWatchSince({ args, deps }: { args: GithubChecksArgs; deps: GithubChecksDeps }): string {
  if (args.since === undefined) {
    return deps.now().toISOString();
  }
  return args.since;
}

/**
 * Close this session's row in the watch register, when there was a head to record one against.
 *
 * An absent `watchedHead` means no read ever established one — a usage refusal, or a fetch that failed on
 * the first lap — and there is nothing to close rather than a watch that ended silently.
 */
function closeWatch({
  deps,
  exit,
  target,
  watchedHead,
}: {
  deps: GithubChecksDeps;
  exit: number;
  target: PollTarget;
  watchedHead: string | undefined;
}): void {
  if (watchedHead === undefined) {
    return;
  }
  deps.recordWatchDone({
    headSha: watchedHead,
    home: target.home,
    number: target.number,
    outcome: watchOutcome({ exit }),
    repo: `${target.owner}/${target.repo}`,
  });
}

/**
 * Run one `github checks` invocation against injected edges.
 *
 * Without `--wait`, one read is reported and the loop exits immediately. With `--wait`, it polls with
 * {@link nextChecksPollDelayMs}'s stepped backoff until every check reaches a terminal state or the
 * timeout expires, printing one compact status line per poll rather than raw provider output — the direct
 * fix for a hand-rolled `gh pr checks` polling loop dumping full output into the caller's own transcript on
 * every poll. With `--until`, the same backoff drives an EVENT loop instead: reviews and comments are read
 * beside the checks, only changes are printed (one line each, so a `Monitor` turns each into one
 * notification), and the watch ends on the mode's own condition or on merge/close. The exit code is itself a
 * signal: `EXIT_OK` only once the awaited condition arrived and no check failed; `EXIT_EXPECTED_EMPTY` for
 * "not finished yet" (including a timeout), "finished, something failed" or "closed unmerged" — all
 * legitimate non-success STATUSES, not a verb fault.
 *
 * @param rest argv after `github checks`
 * @param deps the repo-resolution, checks-fetch, activity-fetch, clock and output seams
 * @returns the process exit code
 */
export async function runGithubChecks({
  rest,
  deps,
}: {
  rest: readonly string[];
  deps: GithubChecksDeps;
}): Promise<number> {
  const parsed = parseGithubChecksArgs({ rest });
  if (parsed.isErr()) {
    writeProblems({ deps, problems: parsed.error });
    deps.writeDiagnostic(githubChecksUsage());
    return EXIT_USAGE;
  }
  const repoResolved = deps.resolveRepo({ explicit: parsed.value.repo });
  if (repoResolved.isErr()) {
    writeProblems({ deps, problems: repoResolved.error });
    return EXIT_ERROR;
  }
  const args: GithubChecksArgs = parsed.value;
  const target = pollTargetOf({ args, deps, repository: repoResolved.value });
  if (args.log) {
    return runChecksLog({ deps, lines: args.lines, target });
  }
  let mode: ChecksWatchMode | undefined;
  if (args.until !== undefined) {
    mode = args.until;
  } else if (args.wait) {
    mode = "wait";
  }
  const recorder = recordFirstRead({ deps, mode, target });
  const { recordRead } = recorder;
  let exit: number;
  if (args.until === undefined) {
    exit = await pollStatusLines({ deps, json: args.json, recordRead, target, wait: args.wait });
  } else {
    exit = await pollEvents({
      deps,
      recordRead,
      since: eventWatchSince({ args, deps }),
      target,
      until: args.until,
    });
  }
  closeWatch({ deps, exit, target, watchedHead: recorder.watchedHead() });
  return exit;
}

import { productionGithubChecksDeps } from "./checksDeps.js";

/** `slopweaver github checks`. */
export const githubChecksCommand = defineCommand({
  run: (argv) => runGithubChecks({ deps: productionGithubChecksDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
