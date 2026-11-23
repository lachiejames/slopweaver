/**
 * Projecting one run journal into one `run` row and its `run_event` children.
 *
 * Pure: a slug, a path and the journal's text in; the rows out. No filesystem and no clock — `derivedAt`
 * is a column the caller's `defaultNow()` fills, so nothing here has to be told the time.
 *
 * ## The fold is stored AND the lines are, and that is not redundancy
 *
 * `../../handover/ledger.ts`'s `runStateOf` folds a journal into a phase, a branch and a doc hash, and
 * `../../handover/runOwner.ts`'s `writerOf` folds it into a writer. Those four values go on the `run` row
 * because every reader wants them and none should have to replay a journal to get them. The lines go into
 * `run_event` because the fold is not stable: `RunEvent` gains a member whenever a new ending is typed, and
 * a run written in August means something different under today's fold than it did under August's. Storing
 * only the fold would make that re-derivation impossible; storing only the lines would make the common
 * query a replay. `derivedAt` is what says which of the two a reader is looking at.
 *
 * ## Why an unreadable line is counted rather than refused
 *
 * `parseLedger` already reports the line numbers that did not decode, and it does that instead of throwing
 * for a reason this projection inherits rather than re-decides: a journal is the thing that survives
 * session death, so it is also the thing most likely to carry a half-written final line, and refusing the
 * whole run because of one would lose every event before it. The unreadable numbers ride out on
 * {@link ProjectedRun.unreadableLines} so a caller REPORTS them rather than dropping them silently.
 */
import { parseLedger, type RunEvent, runStateOf } from "../../handover/ledger.js";
import { type RunWriter, writerOf } from "../../handover/runOwner.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { NewRunEventRecord, NewRunRecord } from "../schema/runs.js";

import { type FleetImportError, FleetImportErrors } from "./errors.js";

/** One run's rows, plus what the journal could not read. */
export interface ProjectedRun {
  /** The parent row. Its `id` is minted by the caller's insert and threaded into each child. */
  readonly run: Omit<NewRunRecord, "id">;
  /**
   * Each journal line as a child row, MINUS the `runId` the caller fills once the parent has an id.
   *
   * In source order, and `lineNumber` is the physical line, so the unique index on
   * `(run_id, line_number)` makes a second import of a grown journal replace what it already holds and add
   * only what is new — the same append-only property `./importKey.ts` gives the ledgers, expressed as a
   * constraint because a journal HAS a natural per-run line number and a ledger does not.
   */
  readonly events: readonly Omit<NewRunEventRecord, "id" | "runId">[];
  /** Physical line numbers that did not decode, carried out so a caller reports rather than drops them. */
  readonly unreadableLines: readonly number[];
}

/** An optional value as the nullable column takes it. See `./autonomyEvent.ts` on why not `??`. */
function orNull<T>({ value }: { value: T | undefined }): T | null {
  if (value === undefined) {
    return null;
  }
  return value;
}

/**
 * The session holding the run's writer claim, as the nullable `writer_session` column takes it.
 *
 * A run has no writer until a `launched`, `resumed` or `claimed` event in its current cycle names one, and
 * none again once that writer released it — `writerOf` says which — so the column is null for that run.
 */
function writerSessionOf({ writer }: { writer: RunWriter | undefined }): string | null {
  if (writer === undefined) {
    return null;
  }
  return writer.sessionId;
}

/**
 * One event's own per-kind fields, with the two every event has removed.
 *
 * `kind` and `atIso` become columns, so leaving them in the payload would store each twice and let the two
 * copies disagree after an edit. The rest is per-kind by construction and rides whole.
 */
function payloadOf({ event }: { event: RunEvent }): Readonly<Record<string, unknown>> {
  const entries = Object.entries(event).filter(([key]) => key !== "kind" && key !== "atIso");
  return Object.fromEntries(entries);
}

/**
 * Project one run journal into the rows an insert takes.
 *
 * @param slug the run's slug — its journal filename, and the board row it executes
 * @param path the journal's path, carried into a failure and stored on the row
 * @param text the journal's full text
 * @returns the parent row, its children and the unreadable line numbers, or the typed refusal
 */
export function projectRunJournal({
  slug,
  path,
  text,
}: {
  slug: string;
  path: string;
  text: string;
}): Result<ProjectedRun, FleetImportError> {
  const parsed = parseLedger({ text });
  const first = parsed.events[0];
  if (first === undefined) {
    return err(FleetImportErrors.missingField({ field: "any readable event", lineNumber: 1, path }));
  }
  const last = parsed.events[parsed.events.length - 1]!;
  const state = runStateOf({ events: parsed.events });
  const writer = writerOf({ events: parsed.events });
  const firstEventAt = new Date(first.atIso);
  const lastEventAt = new Date(last.atIso);
  if (Number.isNaN(firstEventAt.getTime())) {
    return err(FleetImportErrors.unreadableInstant({ lineNumber: 1, path, value: first.atIso }));
  }
  if (Number.isNaN(lastEventAt.getTime())) {
    return err(FleetImportErrors.unreadableInstant({ lineNumber: parsed.events.length, path, value: last.atIso }));
  }
  const events = parsed.events.map((event, index) => ({
    atIso: new Date(event.atIso),
    kind: event.kind,
    // 1-based, and the index into the DECODED events rather than the physical file: `parseLedger` drops
    // the lines it could not read, so a physical number here would leave holes that the unique index
    // would then let a re-import fill with a different event.
    lineNumber: index + 1,
    payload: payloadOf({ event }),
  }));
  return ok({
    events,
    run: {
      branch: orNull({ value: state.branch }),
      docHash: orNull({ value: state.docHash }),
      eventCount: parsed.events.length,
      firstEventAt,
      lastEventAt,
      phase: state.phase,
      slug,
      sourcePath: path,
      writerSession: writerSessionOf({ writer }),
    },
    unreadableLines: parsed.unreadable,
  });
}
