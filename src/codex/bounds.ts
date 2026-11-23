/**
 * The bound, the 85% warn point, and the exit-code decision. Pure arithmetic and pure mapping — the state
 * machine that acts on it lives in {@link ./runPass}.
 *
 * WHY WARN-THEN-CONCLUDE. Kill-at-bound makes every timeout a bet: too tight and a good run is shot
 * seconds from its verdict, too loose and a stray run burns an hour before anyone notices. Retuning the
 * number cannot fix that, because the right number depends on facts you only have after the run. So the
 * bound has two phases: at {@link WARN_FRACTION} the turn is aborted and the thread RESUMED with an
 * instruction to conclude from what it already has; only then is the bound fatal. Measured on the
 * predecessor: a 4-minute-bounded run at 18 exec calls was interrupted, resumed, and produced a clean
 * verdict instead of dying with nothing.
 *
 * The warn does NOT extend the deadline. `conclusionWindowMs` is what is LEFT of the original total, so a
 * warned run gets its bound and not a millisecond more. Measuring per-turn instead would hand a run a
 * fresh bound every time it was warned — which is how a 10-minute bound becomes 18.5 minutes.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO:
 *   * No token ceiling. Over 87 recorded predecessor runs the plan judged excellent cost 13.7M tokens and
 *     the one judged a catastrophe cost 2.8M. The expensive one was the good one; no ceiling separates them.
 *   * No stall/activity detector. A well-scoped pass is told not to read other files, so ZERO tool calls is
 *     the healthy signature of the best runs — and between turn-start and the first item event the event,
 *     token and turn counts are all flat because usage is only reported at turn end. A predecessor run died
 *     exactly there: 10 minutes, two events, killed as stalled, no spend recorded. The only bound is
 *     wall-clock.
 */

import { EXIT_ERROR, EXIT_EXPECTED_EMPTY, EXIT_OK } from "../cli/exitCodes.js";
import { err, ok, type Result } from "../lib/result.js";
import { CodexErrors, type CodexPassBoundInvalidError } from "./errors.js";
import type { DeadlineRuntime, ScheduledTask } from "./runPass.js";
import type { CodexPassOutcome, PassBound, UsageMeasurement } from "./types.js";

/** Fraction of the bound at which the run is asked to conclude rather than killed. */
export const WARN_FRACTION = 0.85;

/**
 * Below this much remaining, a warn buys nothing: the model cannot conclude inside it and the interrupt
 * costs more than it saves. Such a run simply runs to its bound.
 */
const MIN_CONCLUSION_WINDOW_MS = 5_000;

/** The largest bound accepted, so an absurd value fails loudly at parse time rather than hanging for days. */
export const MAX_BOUND_SECONDS = 24 * 60 * 60;

/**
 * Build the bound from an explicitly supplied total.
 *
 * There is no default and no optional parameter, by design: only the caller knows whether this is a
 * narrow review or a long planning pass.
 *
 * @param boundSeconds the total wall-clock budget for the pass, in seconds
 * @returns the bound, or an error naming exactly why the value was refused
 */
export function makePassBound({
  boundSeconds,
}: {
  boundSeconds: number;
}): Result<PassBound, CodexPassBoundInvalidError> {
  if (!Number.isFinite(boundSeconds) || !Number.isInteger(boundSeconds)) {
    return err(CodexErrors.boundNotWhole({ boundSeconds }));
  }
  if (boundSeconds <= 0) {
    return err(CodexErrors.boundNotPositive({ boundSeconds }));
  }
  if (boundSeconds > MAX_BOUND_SECONDS) {
    return err(CodexErrors.boundTooLarge({ boundSeconds, max: MAX_BOUND_SECONDS }));
  }
  const totalMs = boundSeconds * 1000;
  const warnAfterMs = Math.floor(totalMs * WARN_FRACTION);
  return ok({ conclusionWindowMs: totalMs - warnAfterMs, totalMs, warnAfterMs });
}

/**
 * Whether there is enough of the bound left after the warn for a wrap-up turn to be worth attempting.
 *
 * @param bound the pass bound
 * @returns true when the conclusion window is large enough to be useful
 */
export function warnIsWorthwhile({ bound }: { bound: PassBound }): boolean {
  return bound.conclusionWindowMs >= MIN_CONCLUSION_WINDOW_MS;
}

/**
 * The process exit code for a pass outcome.
 *
 * The mapping onto this CLI's four codes matters, because the predecessor's exit 3 = refusal / 4 = no
 * verdict cannot be copied: `EXIT_EXPECTED_EMPTY` is already 3 here and there is no 4.
 *
 * Note there is NO exit code that means "answered, and the answer is BROKEN". A review that finds a real
 * defect SUCCEEDED, so it exits 0 — which is exactly why the stdout document, not the exit status, is the
 * load-bearing signal for a caller deciding whether to proceed.
 *
 * @param outcome the pass outcome
 * @returns the exit code
 */
function exitCodeFor({ outcome }: { outcome: CodexPassOutcome }): number {
  switch (outcome.kind) {
    case "answered":
      return EXIT_OK;
    case "no-verdict":
      return EXIT_EXPECTED_EMPTY;
    case "fatal":
      return EXIT_ERROR;
  }
}

/** How bad an exit code is, so a fan-out can pick the worst without a chain of conditionals. */
function severityOf({ code }: { code: number }): number {
  if (code === EXIT_ERROR) {
    return 3;
  }
  return code === EXIT_EXPECTED_EMPTY ? 2 : 1;
}

/**
 * The exit code for a set of passes run together (review fan-out).
 *
 * Priority is fatal, then no-verdict, then success: a transport fault must not be masked by a sibling
 * that happened to answer, and a pass that never concluded must never read as clean.
 *
 * @param outcomes every pass outcome in the run
 * @returns the aggregate exit code
 */
export function aggregateExitCode({ outcomes }: { outcomes: readonly CodexPassOutcome[] }): number {
  if (outcomes.length === 0) {
    return EXIT_EXPECTED_EMPTY;
  }
  // Worst-first, using the single-pass mapping so the two can never disagree.
  return outcomes
    .map((outcome) => exitCodeFor({ outcome }))
    .reduce((worst, code) => (severityOf({ code }) > severityOf({ code: worst }) ? code : worst), EXIT_OK);
}

/**
 * Render one attempt's usage for human output.
 *
 * A genuine measured zero prints `0`; an absent observation prints `-` with its reason. Those are
 * different facts and this is the one place that distinction becomes text.
 *
 * @param usage the attempt's usage measurement
 * @returns one line per counter, or a single `-` line naming why nothing was measured
 */
export function formatUsage({ usage }: { usage: UsageMeasurement }): readonly string[] {
  if (usage.kind === "not-measured") {
    return [`- (not measured: ${usage.reason})`];
  }
  const u = usage.usage;
  return [
    `input_tokens: ${String(u.input_tokens)}`,
    `cached_input_tokens: ${String(u.cached_input_tokens)}`,
    `cache_write_input_tokens: ${String(u.cache_write_input_tokens)}`,
    `output_tokens: ${String(u.output_tokens)}`,
    `reasoning_output_tokens: ${String(u.reasoning_output_tokens)}`,
  ];
}

/** The armed clock for one pass: one abort controller, one deadline, and an optional warn. */
export interface ArmedBound {
  readonly initialAbort: AbortController;
  readonly deadlineTask: ScheduledTask;
  readonly warnTask: ScheduledTask | undefined;
  /** Whether the DEADLINE (not the warn) is what aborted the turn — they abort the same controller. */
  deadlineReached(): boolean;
}

/**
 * Arm the bound: schedule the warn and the fatal deadline against ONE abort controller.
 *
 * Both fire the same controller, so the caller has to be able to tell them apart afterwards — a warn earns a
 * wrap-up turn, the deadline does not. That is what `deadlineReached()` is for.
 *
 * Both instants are ABSOLUTE, `anchorMs` plus the bound, and each timer's delay is what remains of it right
 * now. A pass arms against its own start; a review's one policy retry (`./policyRetryPass.ts`) arms against
 * the FIRST thread's start, so however long passes before it arms, it can never outlive the original bound —
 * rebuilding the retry's bound as a relative remainder let any gap before arming extend the deadline. A warn
 * whose instant has already passed is not armed at all: the retry then gets the remainder with no warn.
 *
 * @param anchorMs the instant the whole pass started, on `runtime`'s clock
 * @returns the armed tasks and the deadline-reached probe
 */
export function armBound({
  bound,
  runtime,
  anchorMs,
}: {
  bound: PassBound;
  runtime: DeadlineRuntime;
  anchorMs: number;
}): ArmedBound {
  const initialAbort = new AbortController();
  let reached = false;
  const deadlineTask = runtime.schedule({
    delayMs: Math.max(0, bound.totalMs - (runtime.nowMs() - anchorMs)),
    onFire: () => {
      reached = true;
      initialAbort.abort();
    },
  });
  // Read afresh: time spent registering the deadline must not move the warn past its original instant.
  const warnInMs = bound.warnAfterMs - (runtime.nowMs() - anchorMs);
  const warnTask =
    warnIsWorthwhile({ bound }) && warnInMs > 0
      ? runtime.schedule({
          delayMs: warnInMs,
          onFire: () => {
            initialAbort.abort();
          },
        })
      : undefined;
  return { deadlineReached: () => reached, deadlineTask, initialAbort, warnTask };
}
