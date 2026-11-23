/**
 * WHAT THE LOOP'S SWEEP SAYS AND RECORDS ABOUT A DISPATCHED TURN'S BUDGET — the pure half.
 *
 * The owner's ruling (see `./budgetMarks.ts` for the ruling and what it leaves unruled): the loop session raises
 * the warn, on the sweep pass it already runs, with zero new sessions. Three things follow, and each is a
 * function here.
 *
 * - **The evidence line.** The loop judges "converging or circling?" from structured state only — the stages
 *   the worker itself declared, the review round it is on and the claims that round carried forward, and the
 *   clock against the warn mark. Never a transcript, never the stage prose: counts and ages, so the judgement
 *   is not steered by whatever the worker happened to write. {@link budgetEvidenceLine}.
 * - **The two warns.** `clock` is mechanical — the mark was crossed, recorded once. `witness` is the loop's
 *   judgement, one note and nothing else: it never steers, never instructs, never posts. A witness raised
 *   before the mark suppresses the later clock warn, and one raised after the clock warn is still accepted
 *   once, so a generation carries at most one mechanical fact plus one authored observation.
 *   {@link clockWarnToAppend}, {@link witnessWarnToAppend}.
 * - **The readback.** The worker sees the warn where it already looks every beat, in NEUTRAL words: when,
 *   from which source, and the observation. Nothing tells it how to finish — the owner ruled that the worker
 *   decides, and a readback that said "wrap up now" would make the witness a supervisor through the back
 *   door. {@link budgetWorkerLines}.
 *
 * Every read is scoped to ONE dispatch generation: the progress log and the review record are both keyed by
 * the ask, so a re-dispatch shares them, and last generation's six review rounds are not this worker's.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { AskIdentity } from "../ask/identity.js";
import type { DispatchedEvent } from "../ask/lifecycle.js";
import { budgetMarkState } from "./budgetMarks.js";
import type { ProgressLog, ProgressWarnEvent } from "./progressLog.js";
import type { ReviewRecord } from "./review.js";
import { type TurnError, TurnErrors } from "./turnErrors.js";

/** The one dispatch generation a budget reading is about — the two fields every warn binds to. */
type Generation = Pick<DispatchedEvent, "leaseExpiresAt" | "tsIso">;

/** Whether an instant lies inside `[fromIso, toIso]`. Unreadable instants lie outside. */
function within({ fromIso, iso, toIso }: { fromIso: string; iso: string; toIso: string }): boolean {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at >= Date.parse(fromIso) && at <= Date.parse(toIso);
}

/**
 * The warns raised on ONE dispatch generation up to `nowIso`, in file order.
 *
 * A warn dated after `nowIso` is left out as well, so a replay judged at an earlier instant never sees a warn
 * from its own future.
 *
 * @param dispatched the generation being judged
 * @param log the ask's folded progress log
 * @param nowIso the instant the reading is taken at
 * @returns that generation's warns — empty on a fresh re-dispatch of an ask warned before
 */
export function generationWarns({
  dispatched,
  log,
  nowIso,
}: {
  dispatched: Generation;
  log: ProgressLog;
  nowIso: string;
}): readonly ProgressWarnEvent[] {
  return log.warns.filter(
    (warn) =>
      warn.dispatchedIso === dispatched.tsIso &&
      warn.leaseExpiresAt === dispatched.leaseExpiresAt &&
      within({ fromIso: dispatched.tsIso, iso: warn.tsIso, toIso: nowIso }),
  );
}

/**
 * Every warn ALREADY RECORDED against one dispatch generation, whatever its timestamp — the reading an
 * append decision must use.
 *
 * {@link generationWarns} bounds its reading at `nowIso` so a replay never shows a warn from its own future,
 * and that bound is exactly wrong for deciding whether to append: a sweep or note judged at an earlier instant
 * than a warn already in the file — a replay clock, a skewed clock — would not see it and would append a
 * duplicate. Found by independent review of this change, reproduced by running the pure functions: a witness
 * note at 06:00 followed by a sweep at 05:50 appended a clock warn after it.
 *
 * @param dispatched the generation being judged
 * @param log the ask's folded progress log
 * @returns that generation's warns in file order, never time-bounded
 */
function recordedGenerationWarns({
  dispatched,
  log,
}: {
  dispatched: Generation;
  log: ProgressLog;
}): readonly ProgressWarnEvent[] {
  return log.warns.filter(
    (warn) => warn.dispatchedIso === dispatched.tsIso && warn.leaseExpiresAt === dispatched.leaseExpiresAt,
  );
}

/**
 * The warn a reader should see for this generation: the witness's observation when there is one, since it
 * says more than the clock does, otherwise the clock's.
 *
 * @param dispatched the generation being judged
 * @param log the ask's folded progress log
 * @param nowIso the instant the reading is taken at
 * @returns the effective warn, or `undefined` while none has been raised
 */
export function effectiveBudgetWarn({
  dispatched,
  log,
  nowIso,
}: {
  dispatched: Generation;
  log: ProgressLog;
  nowIso: string;
}): ProgressWarnEvent | undefined {
  const warns = generationWarns({ dispatched, log, nowIso });
  const witnessed = warns.find((warn) => warn.source === "witness");
  if (witnessed == null) {
    // No witness observation for this generation: the clock's warn, or none while none has been raised.
    return warns[0];
  }
  return witnessed;
}

/**
 * The clock warn the sweep should append now, or `undefined` when it owes none — before the mark, on an
 * unreadable lease, or once any warn already stands for this generation.
 *
 * @param dispatched the generation being judged
 * @param log the ask's folded progress log
 * @param nowIso the sweep's instant
 * @returns the event to append, or `undefined`
 */
export function clockWarnToAppend({
  dispatched,
  log,
  nowIso,
}: {
  dispatched: Generation;
  log: ProgressLog;
  nowIso: string;
}): ProgressWarnEvent | undefined {
  const mark = budgetMarkState({ dispatchedIso: dispatched.tsIso, leaseExpiresAt: dispatched.leaseExpiresAt, nowIso });
  if (mark.kind !== "past-warn" || recordedGenerationWarns({ dispatched, log }).length > 0) {
    return undefined;
  }
  return {
    dispatchedIso: dispatched.tsIso,
    kind: "warn",
    leaseExpiresAt: dispatched.leaseExpiresAt,
    source: "clock",
    tsIso: nowIso,
  };
}

/**
 * The witness warn the loop asked to record, or every reason it may not.
 *
 * Refuses a note aimed at a generation that is no longer current — the loop judged one dispatch and a
 * re-dispatch landed before the note did — so an observation about one worker never reaches its successor.
 * Refuses a second witness note for the same generation: one note is the witness's entire output.
 *
 * @param dispatched the ask's CURRENT generation
 * @param expectedDispatchedIso the dispatch instant the loop's evidence line named
 * @param log the ask's folded progress log
 * @param note the one-sentence observation
 * @param nowIso the instant it is recorded at
 * @returns the event to append, or the refusals
 */
export function witnessWarnToAppend({
  dispatched,
  expectedDispatchedIso,
  log,
  note,
  nowIso,
}: {
  dispatched: Generation;
  expectedDispatchedIso: string;
  log: ProgressLog;
  note: string;
  nowIso: string;
}): Result<ProgressWarnEvent, TurnError> {
  const trimmed = note.trim();
  if (trimmed.length === 0 || /[\r\n]/.test(trimmed)) {
    return err(TurnErrors.warnNotOneLine());
  }
  if (expectedDispatchedIso !== dispatched.tsIso) {
    return err(TurnErrors.warnStaleDispatch({ current: dispatched.tsIso, expected: expectedDispatchedIso }));
  }
  if (recordedGenerationWarns({ dispatched, log }).some((warn) => warn.source === "witness")) {
    return err(TurnErrors.warnAlreadyRecorded());
  }
  return ok({
    dispatchedIso: dispatched.tsIso,
    kind: "warn",
    leaseExpiresAt: dispatched.leaseExpiresAt,
    note: trimmed,
    source: "witness",
    tsIso: nowIso,
  });
}

/** Whole minutes between two instants, floored at zero. */
function minutesBetween({ fromIso, toIso }: { fromIso: string; toIso: string }): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
}

/** The warn clause of a line: none, or its source and instant. */
function warnClause({ warn }: { warn: ProgressWarnEvent | undefined }): string {
  return warn === undefined ? "none" : `${warn.source} ${warn.tsIso}`;
}

/** The review clause: this generation's round and carried claims, or that no review opened in it. */
function reviewClause({
  dispatched,
  nowIso,
  review,
}: {
  dispatched: Generation;
  nowIso: string;
  review: ReviewRecord | undefined;
}): string {
  if (review === undefined || !within({ fromIso: dispatched.tsIso, iso: review.spawnedAt, toIso: nowIso })) {
    return "no review this dispatch";
  }
  return `review round ${String(review.round)} (${String(review.carriedUnresolved.length)} carried)`;
}

/**
 * The one compact line the sweep prints per still-working dispatch: the structured evidence the loop judges
 * "converging or circling?" from. Counts and ages only, never stage prose — see this module's header.
 *
 * @param askIdentity the ask being swept
 * @param dispatched the ask's current generation, whose instant the loop echoes back with `--warn-dispatched`
 * @param log the ask's folded progress log
 * @param nowIso the sweep's instant
 * @param review the ask's latest review record, when one exists
 * @returns the line to write
 */
export function budgetEvidenceLine({
  askIdentity,
  dispatched,
  log,
  nowIso,
  review,
}: {
  askIdentity: AskIdentity;
  dispatched: Generation;
  log: ProgressLog;
  nowIso: string;
  review: ReviewRecord | undefined;
}): string {
  const ask = `${askIdentity.channel}/${askIdentity.messageTs}`;
  const mark = budgetMarkState({ dispatchedIso: dispatched.tsIso, leaseExpiresAt: dispatched.leaseExpiresAt, nowIso });
  if (mark.kind === "invalid") {
    return `budget: ${ask} — dispatched ${dispatched.tsIso}; the lease cannot be read, so no warn mark exists`;
  }
  const stages = log.stages.filter((stage) => within({ fromIso: dispatched.tsIso, iso: stage.tsIso, toIso: nowIso }));
  const last = stages[stages.length - 1];
  const stageClause =
    last === undefined
      ? "0 stages this dispatch"
      : `${String(stages.length)} stages this dispatch, last ${String(minutesBetween({ fromIso: last.tsIso, toIso: nowIso }))}m ago`;
  const markClause =
    mark.kind === "past-warn"
      ? `warn mark ${mark.warnIso} passed`
      : `warn mark ${mark.warnIso} in ${String(minutesBetween({ fromIso: nowIso, toIso: mark.warnIso }))}m`;
  return (
    `budget: ${ask} — dispatched ${dispatched.tsIso}; ${String(Math.floor(mark.elapsedMs / 60_000))}m of ` +
    `${String(Math.floor(mark.spanMs / 60_000))}m, ${markClause}; ${stageClause}; ` +
    `${reviewClause({ dispatched, nowIso, review })}; warn: ${warnClause({ warn: effectiveBudgetWarn({ dispatched, log, nowIso }) })}`
  );
}

/**
 * What the WORKER is shown about its own budget — neutral facts, never a finishing instruction.
 *
 * @param dispatched the worker's current generation
 * @param log the ask's folded progress log
 * @param nowIso the instant the reading is taken at
 * @returns the lines to print, empty when the lease cannot be read
 */
export function budgetWorkerLines({
  dispatched,
  log,
  nowIso,
}: {
  dispatched: Generation;
  log: ProgressLog;
  nowIso: string;
}): readonly string[] {
  const mark = budgetMarkState({ dispatchedIso: dispatched.tsIso, leaseExpiresAt: dispatched.leaseExpiresAt, nowIso });
  if (mark.kind === "invalid") {
    return [];
  }
  const warn = effectiveBudgetWarn({ dispatched, log, nowIso });
  const markLine = `BUDGET: warn mark ${mark.warnIso} (provisional, two thirds of this dispatch's lease to ${dispatched.leaseExpiresAt}).`;
  if (warn === undefined) {
    return [markLine];
  }
  const said = warn.source === "witness" ? warn.note : "the warn mark was crossed";
  return [
    markLine,
    `BUDGET WARN raised ${warn.tsIso} by the loop's sweep (${warn.source}): ${said}. An observation for your own plan — how this turn ends stays your call.`,
  ];
}
