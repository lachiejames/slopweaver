/**
 * Why a git WRITE run by `worktree.ts`'s `runGitWrite` failed, as one line — here rather than in that file, beside
 * `./gitReadFailure.ts`, so the reason is pure and testable against a literal stderr capture.
 */

/** Git's checkout progress line — overwritten in place with `\r`, so it is noise in an error, never the cause. */
const CHECKOUT_PROGRESS_LINE = /^Updating files:\s+\d+%/;

/** How many trailing stderr lines a failure message keeps once the progress noise is gone. */
const STDERR_TAIL_LINES = 5;

/**
 * The last meaningful lines of a git write's stderr, with the `\r`-overwritten checkout progress removed.
 *
 * Pure, so the exact shape that misleads a diagnosis — a 3KB tail that was ALL progress bar and no
 * error — is testable against a literal capture.
 *
 * @param stderr everything git wrote to stderr, `\r` and all
 * @returns the last few non-progress lines joined with `; `, or an empty string when there were none
 */
export function summariseGitStderr({ stderr }: { stderr: string }): string {
  return stderr
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !CHECKOUT_PROGRESS_LINE.test(line))
    .slice(-STDERR_TAIL_LINES)
    .join("; ");
}

/** The last thing git printed, progress bar included — on a timeout, "still at 89%" IS the useful fact. */
function lastStderrLine({ stderr }: { stderr: string }): string | undefined {
  return stderr
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .findLast((line) => line.length > 0);
}

/**
 * The one-line reason a git write failed, written so the reader learns what actually happened: a timeout
 * says "timed out" and where the checkout had got to, a git error says git's own words, and a signal death
 * says which signal.
 *
 * Pure, for the same reason as {@link summariseGitStderr}.
 *
 * @param args the git argv that failed
 * @param stderr everything git wrote to stderr
 * @param timedOut whether this module killed the process for outrunning its bound
 * @param timeoutMs the bound that was applied, for the message
 * @param code git's exit code, or `null` when it died on a signal
 * @param signal the signal it died on, or `null` when it exited
 * @returns the complete error message
 */
export function describeGitWriteFailure({
  args,
  stderr,
  timedOut,
  timeoutMs,
  code,
  signal,
}: {
  args: readonly string[];
  stderr: string;
  timedOut: boolean;
  timeoutMs: number;
  code: number | null;
  signal: NodeJS.Signals | null;
}): string {
  const detail = summariseGitStderr({ stderr });
  const last = lastStderrLine({ stderr });
  let why: string;
  if (timedOut) {
    why = `timed out after ${Math.round(timeoutMs / 1000)}s${last === undefined ? "" : ` (last output: ${last})`}`;
  } else if (detail.length > 0) {
    why = detail;
  } else if (signal !== null) {
    why = `killed by ${signal}`;
  } else if (code !== null) {
    why = `exit ${String(code)}`;
  } else {
    why = "exit unknown";
  }
  return `git ${args.join(" ")} failed: ${why}`;
}
