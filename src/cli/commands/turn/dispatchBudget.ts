/**
 * The loop's budget warn, as effects — the thin shell over `../../../live/turn/budgetWarn.ts`.
 *
 * The loop session raises the warn on the sweep pass it already runs, zero new sessions.
 * So everything here is reached from a verb that already runs — `turn dispatch --sweep` for the evidence line,
 * the clock warn and the scoped witness note; `turn status`, `turn resume`, `turn watch` and `turn unblock` for
 * reading it back. It reads the ask lifecycle, the dispatch's progress log and its review record, and it
 * appends to the progress log. Nothing else: no provider, no screen, no spawn, no reviewer control, no
 * finalisation, so a warn can never end a turn or post a word into a thread.
 *
 * Scoped to `fresh-visible-session` dispatches, the one tier with a worker running beside the loop. An inline
 * turn IS the loop session, and has nobody to warn.
 */
import { err, ok, type Result } from "#lib/result.js";

import { acquireOperationLock } from "../../../admit/operationLock.js";
import { logger } from "../../../lib/logger.js";
import { type AskIdentity, askIdentityOf } from "../../../live/ask/identity.js";
import { type DispatchedEvent, foldAskLifecycle, parseAskLifecycleLog } from "../../../live/ask/lifecycle.js";
import { readAskLifecycleText } from "../../../live/ask/store.js";
import {
  budgetEvidenceLine,
  budgetWorkerLines,
  clockWarnToAppend,
  effectiveBudgetWarn,
  witnessWarnToAppend,
} from "../../../live/turn/budgetWarn.js";
import { currentDispatchedEvent } from "../../../live/turn/dispatchStore.js";
import {
  appendProgressLogEvent,
  type ProgressLog,
  type ProgressWarnEvent,
  readProgressLog,
  readProgressLogStrict,
} from "../../../live/turn/progressLog.js";
import { readReviewRecord } from "../../../live/turn/reviewStore.js";
import { type TurnError, turnErrorLines } from "../../../live/turn/turnErrors.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import { refuse } from "./core.js";
import { type TurnCommandError, TurnCommandErrors, turnCommandErrorLines } from "./errors.js";
import { TURN_DISPATCH_USAGE } from "./usage.js";

/**
 * The ask's current dispatch when it is a fresh visible session — the only generation a budget is about.
 *
 * @param askIdentity the ask
 * @param home the resolved state home
 * @returns the active dispatch, or `undefined` for any other tier or no active dispatch
 */
function freshDispatchOf({
  askIdentity,
  home,
}: {
  askIdentity: AskIdentity;
  home: string;
}): DispatchedEvent | undefined {
  const dispatched = currentDispatchedEvent({ askIdentity, home });
  return dispatched?.tier === "fresh-visible-session" ? dispatched : undefined;
}

/** A `src/live/turn` refusal, carried into this verb's own union as the lines it prints. */
function fromLiveTurn({ error }: { error: TurnError }): TurnCommandError {
  return TurnCommandErrors.upstreamRefused({ reasons: turnErrorLines({ error }) });
}

/**
 * Run one read, check and append of an ask's warns under this home's operation lock for that ask.
 *
 * The duplicate checks in `../../../live/turn/budgetWarn.ts` read the log and then append, and on their own
 * that is not atomic: Codex review of this change built the counterexample — two `--warn` processes on one
 * generation both read an empty log before either appends, and both succeed. The lock is the same mutex
 * `github stack push` and the recipe slot writers use, so a second writer waits for nothing and is told the
 * write is held, which the loop retries on its next due sweep.
 *
 * **The lock is aged by the WALL clock, never by the judged instant.** A sweep's `nowIso` is caller-controlled
 * (`--now` exists for replay), and the lock takes over a holder older than its stale threshold. Aged by that
 * instant, a sweep judged twenty minutes later stole a live writer's lock and both appended — the second
 * Codex review round's counterexample on this change. Two writers on one machine share one wall clock, so
 * that takeover can only fire for a holder that has genuinely sat fifteen real minutes on a millisecond write.
 *
 * @param askIdentity the ask whose warns are being written
 * @param body the read, check and append to run while holding the lock
 * @param home the resolved state home
 * @param lockNowIso the wall-clock instant the lock is taken at
 * @returns the body's result, or the reason the lock was held
 */
function underWarnLock<T>({
  askIdentity,
  body,
  home,
  lockNowIso,
}: {
  askIdentity: AskIdentity;
  body: () => Result<T, TurnCommandError>;
  home: string;
  lockNowIso: string;
}): Result<T, TurnCommandError> {
  const lock = acquireOperationLock({
    home,
    key: `budget-warn:${askIdentity.channel}-${askIdentity.messageTs}`,
    nowIso: lockNowIso,
  });
  if (lock.isErr()) {
    return err(TurnCommandErrors.warnLocked({ cause: lock.error }));
  }
  try {
    return body();
  } finally {
    lock.value.release();
  }
}

/**
 * Append one warn, turning a failed append into a stated reason rather than a throw.
 *
 * @param askIdentity the ask whose log this is
 * @param event the warn to append
 * @param home the resolved state home
 * @returns the appended warn, or why it was not written
 */
function appendWarn({
  askIdentity,
  event,
  home,
}: {
  askIdentity: AskIdentity;
  event: ProgressWarnEvent;
  home: string;
}): Result<ProgressWarnEvent, TurnCommandError> {
  try {
    appendProgressLogEvent({ askIdentity, event, home });
    return ok(event);
  } catch (error) {
    return err(TurnCommandErrors.warnWriteFailed({ cause: error }));
  }
}

/**
 * The sweep's budget pass over one still-working ask: record the clock warn when the mark has just been
 * crossed, then report the evidence line the loop judges from.
 *
 * Never throws and never touches the thread. A log it cannot read is reported as such and appends nothing —
 * an unreadable file is not evidence that no warn stands.
 *
 * @param askIdentity the ask being swept
 * @param home the resolved state home
 * @param lockNowIso the wall-clock instant the warn lock is taken at — the real clock unless a test pins it
 * @param nowIso the sweep's judged instant, which a replay sets with `--now`
 * @returns the lines to write — empty for an ask with no fresh-visible-session dispatch
 */
export function sweepBudgetLines({
  askIdentity,
  home,
  lockNowIso = new Date().toISOString(),
  nowIso,
}: {
  askIdentity: AskIdentity;
  home: string;
  lockNowIso?: string;
  nowIso: string;
}): readonly string[] {
  const dispatched = freshDispatchOf({ askIdentity, home });
  if (dispatched === undefined) {
    return [];
  }
  const ask = `${askIdentity.channel}/${askIdentity.messageTs}`;
  const pass = underWarnLock({
    askIdentity,
    body: () =>
      readProgressLogStrict({ askIdentity, home })
        .mapErr((error) => fromLiveTurn({ error }))
        .andThen((log) => {
          const clock = clockWarnToAppend({ dispatched, log, nowIso });
          if (clock === undefined) {
            return ok({ log, raised: false });
          }
          return appendWarn({ askIdentity, event: clock, home }).map(
            (event): { log: ProgressLog; raised: boolean } => ({
              log: { ...log, warns: [...log.warns, event] },
              raised: true,
            }),
          );
        }),
    home,
    lockNowIso,
  });
  if (pass.isErr()) {
    return [`budget: ${ask} — no warn recorded this pass: ${turnCommandErrorLines({ error: pass.error }).join("; ")}`];
  }
  const evidence = budgetEvidenceLine({
    askIdentity,
    dispatched,
    log: pass.value.log,
    nowIso,
    review: readReviewRecord({ askIdentity, home }),
  });
  return pass.value.raised ? [`budget warn raised (clock): ${ask} — the warn mark was crossed`, evidence] : [evidence];
}

/**
 * The instant a witness warn is recorded at: the `--now` a replay pins, else the wall clock of a live run.
 *
 * @param nowIso the `--now` instant, or `undefined` for the real clock
 * @returns an ISO instant
 */
function warnedAt({ nowIso }: { nowIso: string | undefined }): string {
  if (nowIso === undefined) {
    return new Date().toISOString();
  }
  return nowIso;
}

/**
 * The scoped `--sweep --ask … --warn` form of `turn dispatch`: record the loop's one witness note and return,
 * before any screen read, card edit, reviewer reconciliation or finalisation the ordinary sweep would run.
 * Lives here rather than in `./dispatch.ts` because that verb file is at its size ratchet, and every effect
 * this form may have is this module's already.
 *
 * @param expectedDispatchedIso the `--warn-dispatched` instant
 * @param home the resolved state home
 * @param note the `--warn` observation
 * @param nowIso the `--now` instant, or `undefined` for the real clock
 * @param only the `--ask` target
 * @returns the process exit code
 */
export function runWitnessWarn({
  expectedDispatchedIso,
  home,
  note,
  nowIso,
  only,
}: {
  expectedDispatchedIso: string | undefined;
  home: string;
  note: string | undefined;
  nowIso: string | undefined;
  only: { readonly channel: string; readonly messageTs: string } | undefined;
}): number {
  if (note === undefined || expectedDispatchedIso === undefined || only === undefined) {
    return refuse({
      code: EXIT_USAGE,
      errors: ["--warn needs --ask <channel>/<messageTs> and --warn-dispatched <iso> together", TURN_DISPATCH_USAGE],
    });
  }
  const folded = foldAskLifecycle({ events: parseAskLifecycleLog({ text: readAskLifecycleText({ home }) }).events });
  const entry = [...folded.values()].find((ask) => ask.channel === only.channel && ask.messageTs === only.messageTs);
  if (entry === undefined) {
    return refuse({ code: EXIT_USAGE, errors: [`--ask: no ask ${only.channel}/${only.messageTs} in this home`] });
  }
  const recorded = recordWitnessWarn({
    askIdentity: askIdentityOf({ source: entry }),
    expectedDispatchedIso,
    home,
    note,
    nowIso: warnedAt({ nowIso }),
  });
  if (recorded.isErr()) {
    return refuse({ code: EXIT_ERROR, errors: turnCommandErrorLines({ error: recorded.error }) });
  }
  logger.out({
    line: `budget warn recorded (witness): ${only.channel}/${only.messageTs} — dispatched ${expectedDispatchedIso}`,
  });
  return EXIT_OK;
}

/**
 * Record the loop's one witness note for one ask's current dispatch — the whole of the scoped
 * `turn dispatch --sweep --ask … --warn` form, with no screen read, card edit or finalisation around it.
 *
 * @param askIdentity the ask the note is about
 * @param expectedDispatchedIso the dispatch instant the evidence line the loop judged named
 * @param home the resolved state home
 * @param note the one-sentence observation
 * @param nowIso the instant it is recorded at
 * @returns the recorded warn, or every reason it was not recorded
 */
function recordWitnessWarn({
  askIdentity,
  expectedDispatchedIso,
  home,
  note,
  nowIso,
}: {
  askIdentity: AskIdentity;
  expectedDispatchedIso: string;
  home: string;
  note: string;
  nowIso: string;
}): Result<ProgressWarnEvent, TurnCommandError> {
  const dispatched = freshDispatchOf({ askIdentity, home });
  if (dispatched === undefined) {
    return err(TurnCommandErrors.warnTargetMissing());
  }
  return underWarnLock({
    askIdentity,
    body: () =>
      readProgressLogStrict({ askIdentity, home })
        .andThen((log) => witnessWarnToAppend({ dispatched, expectedDispatchedIso, log, note, nowIso }))
        .mapErr((error) => fromLiveTurn({ error }))
        .andThen((event) => appendWarn({ askIdentity, event, home })),
    home,
    lockNowIso: new Date().toISOString(),
  });
}

/**
 * What the worker is shown about its own budget, read fresh — the readback `turn status` and `turn resume`
 * print before anything that needs Slack, so a failed card edit can never hide a warn.
 *
 * @param askIdentity the worker's ask
 * @param home the resolved state home
 * @param nowIso the instant the reading is taken at
 * @returns the lines to print, empty for an ask with no fresh-visible-session dispatch
 */
export function workerBudgetLines({
  askIdentity,
  home,
  nowIso,
}: {
  askIdentity: AskIdentity;
  home: string;
  nowIso: string;
}): readonly string[] {
  const dispatched = freshDispatchOf({ askIdentity, home });
  return dispatched === undefined
    ? []
    : budgetWorkerLines({ dispatched, log: readProgressLog({ askIdentity, home }), nowIso });
}

/**
 * Whether the card should show that a warn stands — every running-card writer asks this on every write, so
 * no two writers alternate a warned and an unwarned card.
 *
 * @param askIdentity the ask whose card is being written
 * @param home the resolved state home
 * @param nowIso the instant of the write
 * @returns whether the current generation carries a warn
 */
export function budgetWarned({
  askIdentity,
  home,
  nowIso,
}: {
  askIdentity: AskIdentity;
  home: string;
  nowIso: string;
}): boolean {
  const dispatched = freshDispatchOf({ askIdentity, home });
  return (
    dispatched !== undefined &&
    effectiveBudgetWarn({ dispatched, log: readProgressLog({ askIdentity, home }), nowIso }) !== undefined
  );
}
