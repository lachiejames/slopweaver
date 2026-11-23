/**
 * One `profile standing` write against the store's standing-ask register, apart from the SQL: what the write
 * records, the rows it changes, the order it takes the lock, reads and applies in, and which failure a throw
 * becomes. Pure, bar the seams a caller passes in. The register's shape and its read are `./standingAskRecords.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { isRecord } from "../lib/parsers.js";
import { type ImportMarker, markerRefusal } from "../store/registerImport.js";

import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";
import {
  coverageRowsOf,
  nextJournalSeq,
  type StandingAskInsertRows,
  type StoredStandingAsk,
  type StoredStandingAskEvent,
  type StoredStandingAsks,
  standingAskRowOf,
} from "./standingAskRecords.js";
import { admitStandingAsk, parseStandingAskEvent, type StandingAsk, standingAskLine } from "./standingAsks.js";

/** What one `profile standing` write asks for. */
export type StandingAskRequest =
  | { readonly kind: "add"; readonly ask: StandingAsk }
  | { readonly kind: "withdraw"; readonly id: string; readonly reason: string; readonly withdrawnAtIso: string };

/** What one admitted write records: the event's exact line, and the ask it records or the id it withdraws. */
export type StandingAskWrite =
  | { readonly kind: "record"; readonly ask: StandingAsk; readonly exactLine: string }
  | { readonly kind: "withdraw"; readonly id: string; readonly exactLine: string };

/** What a write reports once its transaction committed. */
export interface StandingAskWriteOutcome {
  readonly kind: "written";
  readonly journalSeq: number;
}

/**
 * Judge one write against the asks standing now, and the exact line it records.
 *
 * @param active the asks standing now, read inside the writing transaction
 * @param request what was asked for
 * @returns the write, or why the register refuses it
 */
export function planStandingAskWrite({
  active,
  request,
}: {
  active: readonly StandingAsk[];
  request: StandingAskRequest;
}): Result<StandingAskWrite, StandingAskError> {
  if (request.kind === "withdraw") {
    if (!active.some((one) => one.id === request.id)) {
      return err(StandingAskErrors.unknownWithdrawal({ id: request.id }));
    }
    const exactLine = standingAskLine({
      event: { id: request.id, kind: "withdrawn", reason: request.reason, withdrawnAtIso: request.withdrawnAtIso },
    });
    return readBack({ exactLine }).map((): StandingAskWrite => ({ exactLine, id: request.id, kind: "withdraw" }));
  }
  const { ask } = request;
  const exactLine = standingAskLine({ event: { kind: "recorded", ...ask } });
  return admitStandingAsk({ active, ask })
    .andThen(() => readBack({ exactLine }))
    .map((): StandingAskWrite => ({ ask, exactLine, kind: "record" }));
}

/**
 * Refuse a line every later read would refuse. The types admit values the grammar does not (an instant that is
 * not ISO, say), so the line is parsed with the reader's own grammar before it is written.
 */
function readBack({ exactLine }: { exactLine: string }): Result<void, StandingAskError> {
  const parsed = parseStandingAskEvent({ line: exactLine, number: 1 });
  if (parsed.isErr()) {
    return err(StandingAskErrors.writeUnreadable({ why: parsed.error.message }));
  }
  return ok(undefined);
}

/** What one admitted `profile standing` write changes: rows to insert, and the generation a withdrawal retires. */
export interface StandingAskWriteRows extends StandingAskInsertRows {
  /** The active generation a withdrawal sets `withdrawn`; its coverage follows by the cascading key. */
  readonly withdrawRowId?: string;
}

/**
 * The rows one admitted write changes, its event at the next journal sequence.
 *
 * @param stored the register as read inside the writing transaction
 * @param write what the plan admitted
 * @param mintId a fresh row id per call
 * @returns the rows, and the sequence the event takes
 */
export function standingAskWriteRows({
  stored,
  write,
  mintId,
}: {
  stored: StoredStandingAsks;
  write: StandingAskWrite;
  mintId: () => string;
}): { readonly rows: StandingAskWriteRows; readonly journalSeq: number } {
  const journalSeq = nextJournalSeq({ events: stored.events });
  const base = { exactLine: write.exactLine, journalSeq, origin: "profile" as const };
  if (write.kind === "withdraw") {
    // The plan admitted it against these very asks, so the id names an active generation.
    const withdrawRowId = stored.asks.find((ask) => ask.askId === write.id && ask.state === "active")!.rowId;
    const event: StoredStandingAskEvent = { ...base, askRowId: withdrawRowId, kind: "withdrawn" };
    return { journalSeq, rows: { asks: [], coverage: [], events: [event], withdrawRowId } };
  }
  const rowId = mintId();
  const ask: StoredStandingAsk = {
    ...standingAskRowOf({ ask: write.ask, origin: "profile", recordedSeq: journalSeq, state: "active" }),
    rowId,
  };
  return {
    journalSeq,
    rows: {
      asks: [ask],
      coverage: coverageRowsOf({ ask: write.ask, askRowId: rowId, state: "active" }),
      events: [{ ...base, askRowId: rowId, kind: "recorded" }],
    },
  };
}

/**
 * Judge the standing-ask marker as a reading snapshot counted it, after the one-time import already ran: a
 * missing marker means that import was undone, and any count but the marker's means imported events were lost or
 * imported twice — either way the snapshot is not the register.
 *
 * @param marker the marker and its counted events, read inside the snapshot, or undefined when none stands
 * @returns the refusal, or undefined when the snapshot may stand
 */
export function standingAskMarkerRefusal({
  marker,
}: {
  marker: ImportMarker | undefined;
}): StandingAskError | undefined {
  if (marker === undefined) {
    return StandingAskErrors.storeUnavailable({
      doing: "read the standing-ask import marker inside the reading snapshot",
      reason: "the marker the import wrote is gone",
    });
  }
  const refused = markerRefusal({ marker });
  if (refused === undefined) {
    return undefined;
  }
  return StandingAskErrors.importMarkerInconsistent(refused.markerInconsistency);
}

/**
 * One write inside its transaction, apart from the SQL: take the lock FIRST — a snapshot read before the wait would
 * decide against a register another writer had already changed — then read, decide, and apply only a decision
 * that was admitted. A refused read or decision applies nothing.
 *
 * @param lock takes the register's transaction-scoped write lock
 * @param read the register, with its marker re-checked, through the same transaction
 * @param decide judges the write against what was read
 * @param apply records the rows, once decided
 * @param mintId a fresh row id per call
 * @returns the event's sequence, or the read's or the decision's refusal
 */
export async function lockedStandingAskWrite({
  lock,
  read,
  decide,
  apply,
  mintId,
}: {
  lock: () => Promise<void>;
  read: () => Promise<Result<StoredStandingAsks, StandingAskError>>;
  decide: (request: { readonly stored: StoredStandingAsks }) => Result<StandingAskWrite, StandingAskError>;
  apply: (request: { readonly rows: StandingAskWriteRows }) => Promise<void>;
  mintId: () => string;
}): Promise<Result<StandingAskWriteOutcome, StandingAskError>> {
  await lock();
  const stored = await read();
  if (stored.isErr()) {
    return err(stored.error);
  }
  const decided = decide({ stored: stored.value });
  if (decided.isErr()) {
    return err(decided.error);
  }
  const { rows, journalSeq } = standingAskWriteRows({ mintId, stored: stored.value, write: decided.value });
  await apply({ rows });
  return ok({ journalSeq, kind: "written" });
}

/**
 * One reading snapshot: the rows FIRST, then the counted marker, then its verdict — a deletion the rows saw is one
 * the count sees too.
 *
 * @param readRows reads the events, active generations and active coverage through the snapshot
 * @param readMarker reads the counted import marker through the SAME snapshot
 * @returns the register, or the marker's refusal
 */
export async function standingAskSnapshotOver({
  readRows,
  readMarker,
}: {
  readRows: () => Promise<StoredStandingAsks>;
  readMarker: () => Promise<ImportMarker | undefined>;
}): Promise<Result<StoredStandingAsks, StandingAskError>> {
  const stored = await readRows();
  const refused = standingAskMarkerRefusal({ marker: await readMarker() });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok(stored);
}

/** The unique indexes a racing write meets: one active generation per id and per card, one event per sequence. */
const RACE_INDEXES: ReadonlySet<string> = new Set([
  "uq_standing_ask_active",
  "uq_standing_ask_coverage_active",
  "uq_standing_ask_event_seq",
  "uq_standing_ask_recorded_seq",
]);

/**
 * Whether a thrown failure is a racing writer: a write meeting one of the register's unique indexes, or a
 * serialization failure (`40001`). Either way the transaction rolled back, so nothing was written. Drizzle wraps
 * the driver's error, so the walk follows `cause` a few links down.
 *
 * @param cause what the transaction threw
 * @returns true for a unique violation on one of those indexes, or a serialization failure
 */
export function isStandingAskWriteRace({ cause }: { cause: unknown }): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && isRecord(current); depth += 1) {
    const constraint = current["constraint_name"];
    if (current["code"] === "23505" && typeof constraint === "string" && RACE_INDEXES.has(constraint)) {
      return true;
    }
    if (current["code"] === "40001") {
      return true;
    }
    current = current["cause"];
  }
  return false;
}

/**
 * A store step that did not finish, in this register's terms: a marker contradicting its tables names both
 * counts, anything else is an outage. Its shape is the import protocol's `StoreStepFailure`, spelled out here.
 *
 * @param doing what the step was for
 * @param reason what the driver said
 * @param markerInconsistency the two counts, when the step was trusting a marker its tables contradict
 * @returns the typed error
 */
export function standingAskStepFailure({
  doing,
  reason,
  markerInconsistency,
}: {
  readonly doing: string;
  readonly reason: string;
  readonly markerInconsistency?: { readonly expected: number; readonly observed: number };
}): StandingAskError {
  if (markerInconsistency !== undefined) {
    return StandingAskErrors.importMarkerInconsistent(markerInconsistency);
  }
  return StandingAskErrors.storeUnavailable({ doing, reason });
}
