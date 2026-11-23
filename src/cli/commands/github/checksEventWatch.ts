/**
 * The `--until` event watch behind `slopweaver github checks`, and the required-context reader both loops share.
 *
 * Split out of `./checksRun.ts`, which keeps the status-line loop and the verb's dispatch: this file reads
 * reviews and comments beside the checks, prints only changes, and ends on the mode's own condition or on
 * merge/close.
 */

import { type GithubChecksSnapshot, nextChecksPollDelayMs } from "../../../live/github/checks.js";
import { diffPrEvents, type PrEventCursor } from "../../../live/github/prEvents.js";
import { type RequiredContextGate, requiredContextGate } from "../../../live/github/requiredContexts.js";
import { EXIT_EXPECTED_EMPTY, EXIT_OK } from "../../exitCodes.js";
import { type GithubChecksUntil, untilSatisfied } from "./checksCore.js";
import { outlastFailedRead } from "./checksRateWait.js";
import type { RecordFirstRead } from "./checksRegister.js";
import type { GithubChecksDeps, PollTarget } from "./checksSeams.js";
import { verdictToAnnounce } from "./checksVerdict.js";

/**
 * Read the base branch's required contexts ONCE per run, and judge each poll's checks against them.
 *
 * Memoised because the required set is a property of the BRANCH, not of the head: re-reading it every poll
 * would spend two provider calls a poll to learn the same two names. The branch itself is only known once
 * the first checks read comes back, which is why this is a lazy closure rather than a preflight.
 *
 * A read that FAILS answers `unreadable` rather than an empty required set, so a permission or transport
 * problem prints as "this run could not rule the false green out" instead of silently reading as satisfied.
 * A RATE-LIMITED read is not memoised: it ends on its own, and a four-hour watch should not wear one refusal
 * as `UNREAD` for the rest of its life.
 *
 * @param deps the injected edges
 * @param target the pull request being polled
 * @returns a function from one snapshot to the gate for it
 */
export function makeRequiredGateReader({
  deps,
  target,
}: {
  deps: GithubChecksDeps;
  target: PollTarget;
}): (args: { snapshot: GithubChecksSnapshot }) => Promise<RequiredContextGate> {
  let read: { branch: string; required: readonly string[] } | { reason: string } | undefined;
  return async ({ snapshot }) => {
    if (read === undefined) {
      const branch = snapshot.baseRef;
      if (branch === undefined) {
        read = { reason: `GitHub reported no base branch for #${String(target.number)}` };
      } else {
        const contexts = await deps.fetchRequiredContexts({
          branch,
          home: target.home,
          owner: target.owner,
          repo: target.repo,
        });
        if (contexts.isErr() && contexts.error.code === "RATE_LIMITED") {
          return { kind: "unreadable", reason: contexts.error.message };
        }
        read = contexts.isErr() ? { reason: contexts.error.message } : { branch, required: contexts.value.contexts };
      }
    }
    if ("reason" in read) {
      return { kind: "unreadable", reason: read.reason };
    }
    return requiredContextGate({
      branch: read.branch,
      checks: snapshot.checks,
      mergeable: snapshot.mergeable,
      required: read.required,
      truncated: snapshot.truncated,
    });
  };
}

/** What one event poll concluded, folded into the next poll's inputs. */
interface EventPollState {
  readonly cursor: PrEventCursor;
  readonly previousHead: string | undefined;
  /** The head the last emitted CI verdict was for, so a verdict is announced once per head. */
  readonly verdictHead: string | undefined;
}

/** Decide whether a poll that ended nothing terminal satisfied `--until`, emitting the `WATCH-DONE` line. */
function settleUntil({
  deps,
  until,
  verdict,
  reviewed,
  commented,
}: {
  deps: GithubChecksDeps;
  until: GithubChecksUntil;
  verdict: { failed: boolean } | undefined;
  reviewed: boolean;
  commented: boolean;
}): number | undefined {
  const reason = untilSatisfied({ ci: verdict !== undefined, commented, reviewed, until });
  if (reason === undefined) {
    return undefined;
  }
  const failed = reason === "ci" && verdict?.failed === true;
  let outcome = reason;
  if (failed) {
    outcome = "ci-failed";
  } else if (reason === "ci") {
    outcome = "ci-green";
  }
  deps.writeOut(`WATCH-DONE ${outcome}`);
  return failed ? EXIT_EXPECTED_EMPTY : EXIT_OK;
}

/**
 * One event poll: fetch both legs, diff, emit, and say whether the watch is done and with what code.
 * `reread` marks a failed read already waited out, which the loop takes again at once, with no backoff.
 */
async function eventPoll({
  deps,
  target,
  state,
  until,
  readGate,
  recordRead,
}: {
  deps: GithubChecksDeps;
  target: PollTarget;
  state: EventPollState;
  until: GithubChecksUntil;
  readGate: (args: { snapshot: GithubChecksSnapshot }) => Promise<RequiredContextGate>;
  recordRead: RecordFirstRead;
}): Promise<{ next: EventPollState; done: number | undefined; reread?: true }> {
  const { home, limit, number, owner, repo } = target;
  const [checks, activity] = await Promise.all([
    deps.fetchChecks({ home, limit, number, owner, repo }),
    deps.fetchActivity({ home, number, owner, repo }),
  ]);
  if (checks.isErr()) {
    return {
      done: await outlastFailedRead({ deps, error: checks.error, events: true, target, wait: true }),
      next: state,
      reread: true,
    };
  }
  if (activity.isErr()) {
    return {
      done: await outlastFailedRead({ deps, error: activity.error, events: true, target, wait: true }),
      next: state,
      reread: true,
    };
  }
  recordRead({ snapshot: checks.value });
  const diff = diffPrEvents({ activity: activity.value, cursor: state.cursor, previousHead: state.previousHead });
  for (const line of diff.lines) {
    deps.writeOut(line);
  }
  const head = activity.value.headSha;
  const verdict = verdictToAnnounce({
    gate: await readGate({ snapshot: checks.value }),
    head,
    snapshot: checks.value,
    state,
  });
  if (verdict !== undefined) {
    deps.writeOut(verdict.line);
  }
  const next = {
    cursor: diff.cursor,
    previousHead: head,
    verdictHead: verdict === undefined ? state.verdictHead : head,
  };
  if (diff.terminal !== undefined) {
    return { done: diff.terminal === "MERGED" ? EXIT_OK : EXIT_EXPECTED_EMPTY, next };
  }
  return { done: settleUntil({ commented: diff.commented, deps, reviewed: diff.reviewed, until, verdict }), next };
}

/**
 * The event loop behind `--until`: changes only, one line each, the first poll a silent baseline.
 *
 * @returns the process exit code when the watched condition arrives, the pull request ends, or the watch times out
 */
export async function pollEvents({
  deps,
  target,
  until,
  since,
  recordRead,
}: {
  deps: GithubChecksDeps;
  target: PollTarget;
  until: GithubChecksUntil;
  since: string;
  recordRead: RecordFirstRead;
}): Promise<number> {
  deps.writeOut(`WATCH pr=${String(target.number)} repo=${target.owner}/${target.repo} until=${until} since=${since}`);
  let state: EventPollState = {
    cursor: { seenCommentIds: new Set(), seenReviewIds: new Set(), since },
    previousHead: undefined,
    verdictHead: undefined,
  };
  const readGate = makeRequiredGateReader({ deps, target });
  for (let attempt = 0; ; attempt += 1) {
    const polled = await eventPoll({ deps, readGate, recordRead, state, target, until });
    state = polled.next;
    if (polled.done !== undefined) {
      return polled.done;
    }
    if (polled.reread) {
      continue;
    }
    const delayMs = nextChecksPollDelayMs({ attempt });
    if (deps.now().getTime() + delayMs > target.deadlineMs) {
      deps.writeOut(`WATCH-TIMEOUT pr=${String(target.number)} after ${String(target.timeoutSeconds)}s`);
      return EXIT_EXPECTED_EMPTY;
    }
    await deps.sleep({ ms: delayMs });
  }
}
