/**
 * The bounded-turn state machine: one initial turn, a warn-then-conclude at 85%, one absolute deadline.
 *
 * The clock and the timers are INJECTED ({@link DeadlineRuntime}) so every branch below is reachable in a
 * unit test with a plain fake — no `vi.useFakeTimers`, no real waiting, and no mocks (which the repo's
 * ESLint testing rules ban outright).
 *
 * ---------------------------------------------------------------------------
 * THE RULES, each from a measured failure
 * ---------------------------------------------------------------------------
 *
 *  * ONE absolute deadline, taken before the first SDK effect. The warn does not extend it: the wrap-up
 *    turn gets `deadline - now`, never a fresh bound. Restarting the clock is how a 10-minute bound
 *    becomes 18.5 minutes.
 *  * AN ANSWERED RUN WINS. If the initial turn returns a valid answer in the same instant the warn timer
 *    fires, that is a success, not a breach. Scoring it as a timeout would corrupt the number the ledger
 *    exists to report.
 *  * RESUME ONCE, and only after a genuine abort. `thread.id` is read ONCE after the rejection — never
 *    polled hopefully, because an aborted thread's id does not appear later. Measured: the id exists from
 *    ~235ms, so at 85% of any realistic bound it is always there; when it is genuinely absent the pass is
 *    `unrecoverable-abort` and says so.
 *  * AN ABORTED TURN'S USAGE AND ITEMS ARE UNMEASURABLE. `run()` rejects, so no `Turn` exists — neither
 *    the token counters nor the item list was ever returned. Both are recorded as `not-measured`. Writing
 *    `0` for either would be the same lie the predecessor's ledger told when it substituted cumulative
 *    input for missing spend and made two near-identical runs read 4.4x apart.
 *  * NO STALL DETECTOR. Zero tool calls is the HEALTHY signature of a well-scoped pass, and between
 *    turn-start and the first item event every activity counter is flat because usage only arrives at turn
 *    end. A predecessor run died exactly there — 10 minutes, two events, killed as stalled, no spend
 *    recorded. Wall-clock is the only bound.
 */

import type { Result } from "../lib/result.js";
import { armBound } from "./bounds.js";
import type { LockedCodexClient } from "./client.js";
import { fatalOutcome, lateAnswer, withFailureCause } from "./fatalOutcome.js";
import { outcomeFromResponse, runOneTurn } from "./passTurn.js";
import { armTripwire } from "./passWatch.js";
import { buildWrapUpPrompt } from "./prompt.js";
import { salvageFromActivity } from "./salvage.js";
import { tripwireExplanation } from "./tripwire.js";
import type {
  CodexAttempt,
  CodexEventSink,
  NoVerdictReason,
  PassBound,
  PassSalvage,
  PlanAnswer,
  ReviewAnswer,
  StructuredPassOutcome,
} from "./types.js";

/** A cancellable scheduled callback. */
export interface ScheduledTask {
  cancel(): void;
}

/** The clock and timer seam. A fake implementation drives every branch of this module in tests. */
export interface DeadlineRuntime {
  /** A monotonic-enough millisecond reading. Injected so tests are deterministic. */
  nowMs(): number;
  /** An ISO timestamp for the record. */
  nowIso(): string;
  schedule({ delayMs, onFire }: { delayMs: number; onFire: () => void }): ScheduledTask;
}

/**
 * The real runtime: `Date` plus `setTimeout`, with the timer unref'd so it never holds the process open.
 *
 * @returns the production clock/timer seam, swapped for a deterministic fake under test
 */
export function systemDeadlineRuntime(): DeadlineRuntime {
  return {
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    schedule: ({ delayMs, onFire }) => {
      const timer = setTimeout(onFire, delayMs);
      timer.unref();
      return {
        cancel: () => {
          clearTimeout(timer);
        },
      };
    },
  };
}

/**
 * What one pass produced: every attempt, the outcome, and the wall-clock actually consumed. Defaults to the plan and
 * review answers every artifact records; a Slack draft pass names its own.
 */
export interface BoundedPassResult<TAnswer = PlanAnswer | ReviewAnswer> {
  readonly attempts: readonly CodexAttempt[];
  readonly outcome: StructuredPassOutcome<TAnswer>;
  readonly observedElapsedMs: number;
}

/**
 * Run one pass under an absolute deadline, warning at 85% and asking for a conclusion rather than dying.
 *
 * A fatal outcome's cause is also stamped onto the turn that failed (`./fatalOutcome.ts`), so the attempt
 * list alone says what each turn met — which is what a review's one policy retry (`./policyRetryPass.ts`)
 * and the fallback standing on two refusals (`./policyFallback.ts`) read.
 *
 * @param client the locked Codex client
 * @param workingDirectory the repo the pass runs against
 * @param prompt the initial prompt
 * @param outputSchema the JSON Schema the response must conform to
 * @param bound the explicit bound (no default exists anywhere)
 * @param runtime the injected clock/timer seam
 * @param validate the domain validator for this pass kind
 * @param onEvent receives each step of the pass as it happens; omit to run blind
 * @param repoRoot the repository the pass was pointed at — reads there are the job, reads far outside it
 *   are the alarm the tripwire watches for
 * @param kind which attempt the first turn records as — `policy-retry` only from `./policyRetryPass.ts`
 * @param anchorMs the instant the deadline and warn count from, when that is not this call's own start
 * @returns every attempt, the outcome, and the wall-clock actually consumed
 */
// The deadline, the warn and the conclusion are ONE decision sequence over one absolute clock; splitting it
// would put the deadline in two places, and a bound that lives in two places is the thing that drifts.
// max-lines-exempt: one decision sequence over one clock — see above.
export async function runBoundedPass<TAnswer = PlanAnswer | ReviewAnswer>({
  client,
  workingDirectory,
  prompt,
  outputSchema,
  bound,
  runtime,
  validate,
  onEvent,
  repoRoot,
  kind = "initial",
  // A retry arms against its first thread's start; a pass on its own, against its own.
  anchorMs = runtime.nowMs(),
}: {
  client: LockedCodexClient;
  workingDirectory: string;
  /** The repository the pass was pointed at. Reads there are the job; reads far outside it are the alarm. */
  repoRoot: string;
  prompt: string;
  outputSchema: unknown;
  bound: PassBound;
  runtime: DeadlineRuntime;
  validate: (args: { response: string }) => Result<TAnswer>;
  /** Receives each step of the pass as it happens. Omit to run blind, which is what this used to do. */
  onEvent?: CodexEventSink | undefined;
  kind?: "initial" | "policy-retry";
  /** When the whole pass started, if not now: a policy retry passes its first thread's start (`armBound`). */
  anchorMs?: number | undefined;
}): Promise<BoundedPassResult<TAnswer>> {
  const startedAtMs = runtime.nowMs();
  const deadlineAtMs = anchorMs + bound.totalMs;
  const attempts: CodexAttempt[] = [];
  const armed = armBound({ anchorMs, bound, runtime });
  const { initialAbort, deadlineTask, warnTask } = armed;
  const watch = armTripwire({ onEvent, repoRoot, runtime, startedAtMs, workspaceRoot: workingDirectory });

  const initial = await runOneTurn({
    input: prompt,
    kind,
    onEvent: watch.onEvent,
    outputSchema,
    runtime,
    signal: AbortSignal.any([initialAbort.signal, watch.abort.signal]),
    thread: client.startThread({ workingDirectory }),
  });
  warnTask?.cancel();
  watch.seal();
  attempts.push(initial.attempt);

  // A tripwire abort ends the pass outright. It gets NO wrap-up turn, because a wrap-up asks a pass to
  // conclude from what it has — and a pass that was reading the wrong thing has nothing worth concluding
  // from. The deadline path is different: there the work was fine and only the clock ran out.
  const tripped = watch.tripped();
  if (tripped !== undefined) {
    deadlineTask.cancel();
    return {
      attempts,
      observedElapsedMs: runtime.nowMs() - startedAtMs,
      outcome: {
        kind: "no-verdict",
        rawFinalResponse: tripwireExplanation({ assessment: tripped }),
        reason: "off-track",
        // Salvaged even here. An abort is a judgement about the pass, and a judgement the reader has to be
        // able to check: the recorded history contains aborts whose stated evidence was a relative path
        // misread as an absolute one, and the commands are what makes that visible.
        salvage: salvageFromActivity({ activity: watch.activity() }),
      },
    };
  }

  // AN ANSWERED RUN WINS, even if the warn fired in the same instant. And a non-abort failure is fatal:
  // a broken transport does not become a verdict by being asked again.
  const salvage = (): PassSalvage | null => salvageFromActivity({ activity: watch.activity() });
  const reported = (): string | undefined => watch.activity().lastReportedFailure;
  const settled = settledWithoutWarn({ deadlineAtMs, initial, reported, runtime, salvage, validate });
  if (settled !== undefined) {
    deadlineTask.cancel();
    return withFailureCause({
      result: { attempts, observedElapsedMs: runtime.nowMs() - startedAtMs, outcome: settled },
    });
  }

  // The wrap-up turn's fault must name the wrap-up turn's cause. The fold keeps running across both turns, so a
  // failure the initial turn reported before its abort would otherwise be recorded against a different fault.
  watch.beginTurn();
  const conclusion = await concludeAfterWarn({
    attempts,
    client,
    deadlineAtMs,
    deadlineReached: armed.deadlineReached(),
    onEvent: watch.onEvent,
    outputSchema,
    reported,
    runtime,
    salvage,
    threadId: initial.attempt.threadId,
    validate,
    workingDirectory,
  });
  deadlineTask.cancel();
  return withFailureCause({
    result: { attempts, observedElapsedMs: runtime.nowMs() - startedAtMs, outcome: conclusion },
  });
}

/**
 * The outcome when the initial turn settled on its own — answered, or failed for a reason that is not an
 * abort. Undefined means the turn was aborted and has therefore earned a wrap-up attempt.
 */
function settledWithoutWarn<TAnswer>({
  deadlineAtMs,
  initial,
  reported,
  runtime,
  salvage,
  validate,
}: {
  deadlineAtMs: number;
  initial: Awaited<ReturnType<typeof runOneTurn>>;
  /** The stream's last reported failure, read at the moment the fault is recorded. */
  reported: () => string | undefined;
  runtime: DeadlineRuntime;
  salvage: () => PassSalvage | null;
  validate: (args: { response: string }) => Result<TAnswer>;
}): StructuredPassOutcome<TAnswer> | undefined {
  if (initial.finalResponse !== null) {
    // A transport can ignore the abort and answer late; that answer is past the bound, so it is not a verdict.
    if (runtime.nowMs() > deadlineAtMs) {
      return lateAnswer({ finalResponse: initial.finalResponse, salvage });
    }
    return outcomeFromResponse({ finalResponse: initial.finalResponse, salvage, validate });
  }
  return initial.aborted
    ? undefined
    : fatalOutcome({ error: initial.error, operation: "codex.run", reported, salvage });
}

/**
 * Why a wrap-up turn cannot be attempted, or undefined when it can.
 *
 * The thread id is read ONCE by the caller: an aborted thread's id does not materialise later, so polling
 * for it would only burn the remaining window on hope.
 */
function whyNoConclusion({
  threadId,
  deadlineReached,
  deadlineAtMs,
  runtime,
}: {
  threadId: string | null;
  deadlineReached: boolean;
  deadlineAtMs: number;
  runtime: DeadlineRuntime;
}): NoVerdictReason | undefined {
  if (threadId === null) {
    return "unrecoverable-abort";
  }
  return deadlineReached || deadlineAtMs - runtime.nowMs() <= 0 ? "no-conclusion-in-bound" : undefined;
}

/**
 * The wrap-up turn: resume the thread inside what remains of the ORIGINAL deadline and ask for a
 * conclusion. Never a fresh bound.
 */
async function concludeAfterWarn<TAnswer>({
  attempts,
  client,
  deadlineAtMs,
  deadlineReached,
  onEvent,
  outputSchema,
  reported,
  runtime,
  salvage,
  threadId,
  validate,
  workingDirectory,
}: {
  attempts: CodexAttempt[];
  client: LockedCodexClient;
  deadlineAtMs: number;
  deadlineReached: boolean;
  onEvent?: CodexEventSink | undefined;
  outputSchema: unknown;
  /** Read LAZILY, like `salvage`, so a failure the wrap-up turn itself reported is the one recorded. */
  reported: () => string | undefined;
  runtime: DeadlineRuntime;
  /** Read LAZILY, after the wrap-up turn, so its own message is in the fold by the time it is taken. */
  salvage: () => PassSalvage | null;
  threadId: string | null;
  validate: (args: { response: string }) => Result<TAnswer>;
  workingDirectory: string;
}): Promise<StructuredPassOutcome<TAnswer>> {
  const blocked = whyNoConclusion({ deadlineAtMs, deadlineReached, runtime, threadId });
  if (blocked !== undefined || threadId === null) {
    // The bound was already spent, so there is no wrap-up turn to run — and this is the path that used to
    // record a full-bound pass as `rawFinalResponse: null`, discarding every command it had run.
    return {
      kind: "no-verdict",
      rawFinalResponse: null,
      // `whyNoConclusion` answers `unrecoverable-abort` for a null thread id, so on this branch `blocked` is set.
      reason: blocked!,
      salvage: salvage(),
    };
  }
  const wrapUp = await wrapUpTurn({
    client,
    deadlineAtMs,
    onEvent,
    outputSchema,
    runtime,
    threadId,
    workingDirectory,
  });
  attempts.push(wrapUp.attempt);
  return conclusionOutcome({ deadlineAtMs, reported, runtime, salvage, validate, wrapUp });
}

/** Resume the thread and run the wrap-up turn inside what remains of the ORIGINAL deadline. */
async function wrapUpTurn({
  client,
  deadlineAtMs,
  onEvent,
  outputSchema,
  runtime,
  threadId,
  workingDirectory,
}: {
  client: LockedCodexClient;
  deadlineAtMs: number;
  onEvent?: CodexEventSink | undefined;
  outputSchema: unknown;
  runtime: DeadlineRuntime;
  threadId: string;
  workingDirectory: string;
}): Promise<Awaited<ReturnType<typeof runOneTurn>>> {
  const remainingMs = deadlineAtMs - runtime.nowMs();
  const conclusionAbort = new AbortController();
  const conclusionTask = runtime.schedule({
    delayMs: remainingMs,
    onFire: () => {
      conclusionAbort.abort();
    },
  });
  const turn = await runOneTurn({
    input: buildWrapUpPrompt({ remainingMs }),
    kind: "conclusion",
    onEvent,
    outputSchema,
    runtime,
    signal: conclusionAbort.signal,
    thread: client.resumeThread({ threadId, workingDirectory }),
  });
  conclusionTask.cancel();
  return turn;
}

/**
 * Interpret the wrap-up turn.
 *
 * A LATE ANSWER IS NOT AN ANSWER. `AbortSignal` only REQUESTS cancellation: the SDK may handle it slowly and
 * still resolve successfully after the deadline has passed. Accepting that would let a pass report a verdict
 * having consumed more than its requested bound — precisely the guarantee the bound exists to give. Found by
 * this tool reviewing its own diff. The attempt stays in the record either way, because
 * the work really happened and its usage is real; it simply does not become a verdict.
 */
function conclusionOutcome<TAnswer>({
  wrapUp,
  deadlineAtMs,
  reported,
  runtime,
  salvage,
  validate,
}: {
  wrapUp: Awaited<ReturnType<typeof runOneTurn>>;
  deadlineAtMs: number;
  reported: () => string | undefined;
  runtime: DeadlineRuntime;
  salvage: () => PassSalvage | null;
  validate: (args: { response: string }) => Result<TAnswer>;
}): StructuredPassOutcome<TAnswer> {
  if (wrapUp.finalResponse === null) {
    return wrapUp.aborted
      ? { kind: "no-verdict", rawFinalResponse: null, reason: "no-conclusion-in-bound", salvage: salvage() }
      : fatalOutcome({ error: wrapUp.error, operation: "codex.resume", reported, salvage });
  }
  if (runtime.nowMs() > deadlineAtMs) {
    return lateAnswer({ finalResponse: wrapUp.finalResponse, salvage });
  }
  return outcomeFromResponse({ finalResponse: wrapUp.finalResponse, salvage, validate });
}
