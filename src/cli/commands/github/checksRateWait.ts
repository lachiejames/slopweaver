/**
 * What a `github checks` watch does when one of its reads FAILS: outlast a rate limit, or end out loud.
 *
 * Measured on an acme-admin pull request: a `--until merge` watch with a four-hour timeout
 * died, about two and a half hours in, on the first read GitHub refused on the rate limit — `API rate limit already exceeded for user
 * ID …`. A bare death printed that on the diagnostic channel only, named no reset, and wrote nothing on stdout, so the
 * seat reading its event lines through `2>&1 | grep -v …` saw a watch that simply ended, and the pipe reported
 * grep's exit 0. Two defects, both handled here:
 *
 * - **A rate limit names its own end, so a watch waits for it** rather than dying — as long as the reset lands
 *   inside the watch's own deadline. Past it, the watch ends with the reset instant in hand.
 * - **An event watch never ends silently on stdout.** Every death prints a `WATCH-FAILED` line beside
 *   `WATCH-DONE` and `WATCH-TIMEOUT`, so a reader filtering the event stream sees a death as a death whatever
 *   the pipe's exit status says.
 */

import type { GithubLiveError } from "../../../live/github/errors.js";
import { EXIT_ERROR } from "../../exitCodes.js";

/** Margin past the reset instant, so the retry lands after GitHub's own window has turned over. */
const RESET_MARGIN_MS = 1000;

/** The retry interval when GitHub refused on the limit but named no reset. */
export const UNKNOWN_RESET_WAIT_MS = 60_000;

/** One failed read's outcome: wait this long and read again, or stop with this line. */
export type FailedReadStep = { kind: "wait"; ms: number; line: string } | { kind: "stop"; line: string };

/** A provider message on one line, so each event stays one line a `Monitor` turns into one notification. */
function oneLine({ text }: { text: string }): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Decide what one failed read means for a watch. Pure: the clock and the deadline are inputs.
 *
 * @param error the typed failure the read returned
 * @param nowMs the clock at the failure
 * @param deadlineMs the instant the watch's own `--timeout-seconds` runs out
 * @param timeoutSeconds that timeout as the caller gave it, for the line
 * @returns `wait` for a rate limit whose reset lands inside the deadline, `stop` for everything else
 */
export function failedReadStep({
  error,
  nowMs,
  deadlineMs,
  timeoutSeconds,
}: {
  error: GithubLiveError;
  nowMs: number;
  deadlineMs: number;
  timeoutSeconds: number;
}): FailedReadStep {
  if (error.code !== "RATE_LIMITED") {
    return { kind: "stop", line: `WATCH-FAILED ${oneLine({ text: error.message })}` };
  }
  const { resetAt } = error;
  if (resetAt === undefined) {
    if (nowMs + UNKNOWN_RESET_WAIT_MS > deadlineMs) {
      return {
        kind: "stop",
        line: `WATCH-FAILED rate-limited, GitHub named no reset, ${String(timeoutSeconds)}s deadline too near to retry`,
      };
    }
    const seconds = String(UNKNOWN_RESET_WAIT_MS / 1000);
    return {
      kind: "wait",
      line: `RATE-LIMITED, GitHub named no reset, retrying in ${seconds}s`,
      ms: UNKNOWN_RESET_WAIT_MS,
    };
  }
  const ms = Math.max(Date.parse(resetAt) - nowMs + RESET_MARGIN_MS, RESET_MARGIN_MS);
  if (nowMs + ms > deadlineMs) {
    return {
      kind: "stop",
      line: `WATCH-FAILED rate-limited until ${resetAt}, past the ${String(timeoutSeconds)}s deadline`,
    };
  }
  return { kind: "wait", line: `RATE-LIMITED until ${resetAt}, waiting ${String(Math.ceil(ms / 1000))}s`, ms };
}

/**
 * Act on one failed read: sleep out a rate limit and say so, or report the death and return the exit code.
 *
 * `events` picks the channel. An event watch writes both the wait and the death on stdout, beside its other
 * event lines, because that is the stream a caller filters and a `Monitor` notifies on. A status-line run keeps
 * stdout for its status lines and its `--json` document, so it says the same on the diagnostic channel. Either
 * way the provider's own message stays on the diagnostic channel on a death, carrying the reset when there is
 * one. A read with `--wait` absent never waits: it was asked for one read, and one read failed.
 *
 * @param deps the clock, the sleep and both output channels
 * @param error the typed failure the read returned
 * @param target the deadline and timeout the watch runs under
 * @param wait whether the caller asked to keep watching at all
 * @param events whether this is an `--until` event watch rather than a status-line run
 * @returns `undefined` once a wait has been slept and the read should be taken again; else `EXIT_ERROR`
 */
export async function outlastFailedRead({
  deps,
  error,
  target,
  wait,
  events,
}: {
  deps: {
    readonly now: () => Date;
    readonly sleep: (args: { ms: number }) => Promise<void>;
    readonly writeOut: (line: string) => void;
    readonly writeDiagnostic: (line: string) => void;
  };
  error: GithubLiveError;
  target: { deadlineMs: number; timeoutSeconds: number };
  wait: boolean;
  events: boolean;
}): Promise<number | undefined> {
  const say = events ? deps.writeOut : deps.writeDiagnostic;
  if (wait) {
    const step = failedReadStep({
      deadlineMs: target.deadlineMs,
      error,
      nowMs: deps.now().getTime(),
      timeoutSeconds: target.timeoutSeconds,
    });
    if (step.kind === "wait") {
      say(step.line);
      await deps.sleep({ ms: step.ms });
      return undefined;
    }
    deps.writeDiagnostic(error.message);
    if (events) {
      say(step.line);
    }
    return EXIT_ERROR;
  }
  deps.writeDiagnostic(error.message);
  return EXIT_ERROR;
}
