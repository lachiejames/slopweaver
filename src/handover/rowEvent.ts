/**
 * The board row's ONE write path: validate, guard the transition, append, read back — and the four are one
 * act or none of them happened.
 *
 * State is derived, with no second copy. A row's register is its journal, and this is the only door into it.
 * A verb that built a `RunEvent` literal and called {@link ./runStore.appendRunEvent} directly would leave
 * nothing checking that the event was well-formed, nothing checking it could follow what the register
 * already said, and nothing checking the file read back as what was written.
 *
 * ## The three steps, and why the third is not paranoia on files
 *
 * 1. **Validate** against {@link ./rowEventSchema.ROW_EVENT_SCHEMAS}. A refused event is never coerced and
 *    never partially written.
 * 2. **Re-derive** the run's state including the new event, and refuse a transition the vocabulary forbids.
 *    The rules are deliberately few — see `./rowEventRefusal.ts`'s `forbiddenTransition` — because a guard that second-guesses a
 *    verb it does not understand is a guard that gets bypassed.
 * 3. **Append, then read the file back and compare.** A write whose read-back does not match is a FAILURE,
 *    not a warning: an append that silently truncated, interleaved with another process, or landed on a file
 *    a concurrent writer had rewritten is exactly the "decision silently forgotten" this register exists to
 *    end, and it is undetectable from the return value of `appendFileSync`.
 *
 * **The files backend genuinely needs that second read; a store would not.** `INSERT … RETURNING` hands back
 * the committed row inside the same transaction, so the read-back cannot observe a different world than the
 * write did — same three steps, one fewer act. That difference is the reason the CONTRACT here is
 * "one act, all-or-nothing" rather than any particular primitive: nothing above this line knows whether the
 * act was an atomic append or a transaction, so a move onto a store changes this file and no caller.
 *
 * ## What this file deliberately does NOT do
 *
 * It does not send the mutation anywhere. The transactional-outbox half of the design — a row event and an
 * outbox entry committing in one local transaction, so a mutation is committed to GO off-machine with no
 * network in the critical path — is drafted and correct, and its TARGET is open: the owner's rule is that there
 * is no third place, which leaves open where an outbox would drain to without touching the mechanism.
 * Picking one here quietly is the exact move that rule is against, so this write path is built to have an
 * outbox added inside step 3 and carries none.
 */

import type { IngestError } from "#lib/ingestError.js";
import { err, ok, type Result } from "#lib/result.js";
import { ledgerLine, type ParsedLedger, type RunEvent, type RunState, runStateOf } from "./ledger.js";
import { type RowWriteError, RowWriteErrors } from "./rowEventErrors.js";
import { evidenceRefusal, transitionRefusal } from "./rowEventRefusal.js";
import { rowEventIssues } from "./rowEventSchema.js";
import { appendRunEvent, readRunJournal } from "./runStore.js";

export type { RowWriteError } from "./rowEventErrors.js";

/** What a successful write produced: where it landed, and the row's state with the new event folded in. */
export interface RowEventWritten {
  /** The journal path the event was appended to. */
  readonly path: string;
  /** The run state as it stands AFTER the write — re-derived from the file, never from the caller's guess. */
  readonly state: RunState;
  /**
   * The lines the pre-append read could not decode, which this write went ahead beside — so a verb can STATE
   * what it skipped rather than leave the reader to discover it. Empty on a clean journal.
   */
  readonly skipped: Pick<ParsedLedger, "unknownKind" | "unreadable">;
}

/** Lift a journal boundary failure into this domain's own union, carrying the typed cause forward. */
function io({ cause }: { cause: IngestError }): RowWriteError {
  return RowWriteErrors.journalIo({ cause });
}

/**
 * Write one event to a row's register — the only supported way to do so.
 *
 * @param runsDir the runs directory holding one `<slug>.jsonl` per row
 * @param slug the row's slug, which is also its journal's filename
 * @param event the event to record
 * @param precondition a caller's own refusal, judged over the SAME read the transition checks use — so a fact the
 *   caller decided on (a released holder, say) is re-checked where `orphaned`'s stale-holder guard is, rather than
 *   on an earlier read a claim can land after
 * @returns where it landed and the state it produced, or the single typed reason it did not
 */
export function applyRowEvent({
  runsDir,
  slug,
  event,
  precondition,
}: {
  runsDir: string;
  slug: string;
  event: RunEvent;
  precondition?: (args: { events: readonly RunEvent[]; unreadable: readonly number[] }) => string | undefined;
}): Result<RowEventWritten, RowWriteError> {
  const issues = rowEventIssues({ event });
  if (issues.length > 0) {
    return err(RowWriteErrors.invalidEvent({ issues, kind: namedKind({ event }) }));
  }
  const before = readRunJournal({ runsDir, slug });
  if (before.isErr()) {
    return err(io({ cause: before.error }));
  }
  const refusal = transitionRefusal({
    event,
    events: before.value.events,
    precondition,
    unreadable: before.value.unreadable,
  });
  if (refusal !== undefined) {
    return err(refusal);
  }
  const evidence = evidenceRefusal({
    event,
    events: before.value.events,
    unreadable: before.value.unreadable,
  });
  if (evidence !== undefined) {
    return err(evidence);
  }
  const appended = appendRunEvent({ event, runsDir, slug });
  if (appended.isErr()) {
    return err(io({ cause: appended.error }));
  }
  return readBack({
    before: before.value.events.length,
    event,
    path: appended.value,
    runsDir,
    skipped: { unknownKind: before.value.unknownKind, unreadable: before.value.unreadable },
    slug,
  });
}

/*
 * Why the comparison below normalises key ORDER, and why that is not a loosening.
 *
 * `ledgerLine` serialises in the object's own insertion order, and an event's decoder in `./ledger.ts`
 * rebuilds its fields in the order THAT file lists them. For every event kind carrying one payload field
 * the two orders coincided, so the check compared the two strings directly for as long as that held.
 *
 * It stopped holding the moment `question` grew companions: `handover ask` builds
 * `{ atIso, kind, question, lean, options, problem }` and the decoder answers
 * `{ atIso, kind, lean, options, problem, question }`. Identical events, byte-different lines, and the verb
 * refused its own correct write — MEASURED on `handover ask --problem --options --lean`.
 *
 * The property this check is FOR is that no field is lost between memory and disk, and key order is not a
 * field. Normalising it keeps that property exact and drops a sensitivity nothing ever wanted; aligning the
 * two orders by hand instead would leave the next added field to rediscover this.
 */

/** One event as a line whose object keys are in a fixed order, so two orderings of one event compare equal. */
function keyOrderedLine({ event }: { event: RunEvent }): string {
  return JSON.stringify(sortedDeep({ value: event }));
}

/**
 * The kind a refusal names, read once more after validation has already refused the event. That event may be one
 * whose `kind` read throws — the reason it was refused — so the read is guarded and the refusal names it as
 * unreadable rather than throwing past the `Result`.
 */
function namedKind({ event }: { event: RunEvent }): string {
  try {
    const kind: unknown = event.kind;
    return typeof kind === "string" ? kind : "an event with no string kind";
  } catch {
    return "an event whose kind cannot be read";
  }
}

/** The same value with every object's keys sorted, recursively — arrays keep their order, which is data. */
function sortedDeep({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((member) => sortedDeep({ value: member }));
  }
  if (!isPlainRecord(value)) {
    return value;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).toSorted()) {
    out[key] = sortedDeep({ value: value[key] });
  }
  return out;
}

/**
 * Whether a value is an object whose own keys can be read — the only shape whose key order is a choice.
 *
 * Positional because TypeScript error TS1230 forbids destructuring a type predicate's parameter, which
 * `.claude/rules/typescript-patterns.md` exempts by name.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Why a TAG's read-back cannot be called clean because undecodable lines appeared around the append, or
 * `undefined` when none did or the event is another kind.
 *
 * A pre-append check is not compare-and-append: another writer can land a malformed line between the read and
 * the append, and the count-and-last-event comparison below still passes, because a line nothing decodes is
 * not an event. So the tag this call wrote is committed next to a line that may hold a tag it contradicts, and
 * that is reported as a failure rather than prevented — the filesystem backend cannot prevent it. Scoped to `tagged`, the one kind refused onto such a journal in the first place besides a ruling,
 * whose own history guard reads the journal differently.
 *
 * @param before undecodable lines the pre-append read saw
 * @param after undecodable lines the read-back saw
 * @param event the event that was written
 * @returns the mismatch as the read-back error names it
 */
export function unreadableGrowth({
  before,
  after,
  event,
}: {
  before: number;
  after: number;
  event: RunEvent;
}): string | undefined {
  if (event.kind !== "tagged" || after <= before) {
    return undefined;
  }
  return `${String(after - before)} undecodable line(s) appeared around the append, so this tag may sit beside one it contradicts`;
}

/**
 * A tag's read-back: the event is in what was appended since the pre-append read, and nothing else there is a tag.
 *
 * Tag writers share one board-wide lock (`./tagStore.ts`); every OTHER row writer does not, so a `handover start`
 * or a hook may legitimately land an event on either side of this append. Demanding `before + 1` events with this
 * one last would report a committed tag as failed on a clean journal. So a decodable non-tag
 * event in the suffix is allowed, a second `tagged` event is not — no supported writer could have put it there —
 * and undecodable growth is still refused by {@link unreadableGrowth} before this runs.
 */
function taggedLanded({
  appended,
  event,
  events,
  path,
  skipped,
}: {
  appended: readonly RunEvent[];
  event: RunEvent;
  events: readonly RunEvent[];
  path: string;
  skipped: RowEventWritten["skipped"];
}): Result<RowEventWritten, RowWriteError> {
  const wrote = ledgerLine({ event }).trim();
  const tags = appended.filter((each) => each.kind === "tagged");
  const [only] = tags;
  if (tags.length !== 1 || only === undefined || keyOrderedLine({ event: only }) !== keyOrderedLine({ event })) {
    return err(
      RowWriteErrors.readBackMismatch({
        read: `${String(tags.length)} tagged event(s) among the ${String(appended.length)} appended since the read, where exactly this one was expected`,
        wrote,
      }),
    );
  }
  return ok({ path, skipped, state: runStateOf({ events }) });
}

/**
 * Re-read the journal and prove the event is on it — step 3's second half.
 *
 * Compares the SERIALISED forms rather than the objects, because that is what a later reader actually sees:
 * a field that survived in memory and not through `JSON.stringify` → `parseLedger` would pass an object
 * comparison and still be lost on disk. Two things are checked, and the second is the one a length check
 * alone would miss: the journal grew by exactly one decodable event, and that event is this one.
 *
 * @param before how many events the journal held before the append
 * @param event the event that was written
 * @param path the journal path, returned so a caller can name it
 * @param skipped the undecodable lines the pre-append read saw, handed back so the caller can state them
 * @returns the write's outcome, or the mismatch
 */
function readBack({
  before,
  event,
  path,
  runsDir,
  skipped,
  slug,
}: {
  before: number;
  event: RunEvent;
  path: string;
  runsDir: string;
  skipped: RowEventWritten["skipped"];
  slug: string;
}): Result<RowEventWritten, RowWriteError> {
  const after = readRunJournal({ runsDir, slug });
  if (after.isErr()) {
    return err(io({ cause: after.error }));
  }
  const grown = unreadableGrowth({ after: after.value.unreadable.length, before: skipped.unreadable.length, event });
  if (grown !== undefined) {
    return err(RowWriteErrors.readBackMismatch({ read: grown, wrote: ledgerLine({ event }).trim() }));
  }
  const events = after.value.events;
  if (event.kind === "tagged") {
    return taggedLanded({ appended: events.slice(before), event, events, path, skipped });
  }
  const last = events[events.length - 1];
  const wrote = ledgerLine({ event }).trim();
  if (events.length !== before + 1 || last === undefined) {
    return err(
      RowWriteErrors.readBackMismatch({
        read: `${String(events.length)} event(s) where ${String(before + 1)} were expected`,
        wrote,
      }),
    );
  }
  const read = ledgerLine({ event: last }).trim();
  if (keyOrderedLine({ event: last }) !== keyOrderedLine({ event })) {
    return err(RowWriteErrors.readBackMismatch({ read, wrote }));
  }
  return ok({ path, skipped, state: runStateOf({ events }) });
}
