/**
 * The steer-measurement register's rows, apart from the SQL: the ids an imported or appended line takes, the rows the
 * one-time import writes, and how the stored lines read back as the history `profile steers` folds. Pure.
 *
 * The table holds each line exactly and nothing parsed (`../store/schema/steerMeasurements.ts`), so a read is the
 * journal's own grammar over the stored lines, each numbered by its `journal_seq` — an imported line's 1-based place
 * in its file — which is why a line that would not read is named by the same number before and after the import.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ImportMarker, type ImportSource, markerRefusal, sha256Hex } from "../store/registerImport.js";
import type { WitnessedJournal, WitnessedJournalLine } from "../store/witnessedJournal.js";

import {
  parseNumberedSteerVerdicts,
  type SteerHistory,
  type SteerVerdict,
  steerVerdictLine,
  steerVerdictOf,
} from "./steerKinds.js";
import { type SteerMeasurementError, SteerMeasurementErrors } from "./steerMeasurementErrors.js";

/** Every writer a measurement can name, spelled as the schema's enum spells them. */
export const STEER_MEASUREMENT_ORIGINS = ["legacy-file", "profile", "store-import"] as const;

/** Which writer produced a measurement. */
type SteerMeasurementOrigin = (typeof STEER_MEASUREMENT_ORIGINS)[number];

/** What a legacy id digests ahead of the line, so a change to the scheme can never mint an id the old one did. */
const IMPORTED_ID_SCHEME = "slopweaver:steer-measurements:v1";

/**
 * The id an imported line takes: the full sha256 over the scheme, the line's own digest and its place in the file —
 * so two installs importing the same file name every measurement alike, a line written twice is two measurements,
 * and the id binds both what a row says and where it stands, which is what lets every read re-derive it.
 *
 * @param exactLine the line exactly as the file held it
 * @param sourceOrdinal its 1-based place in the file, blanks counted
 * @returns `steer-legacy-<64 hex>`
 */
export function importedSteerEventId({
  exactLine,
  sourceOrdinal,
}: {
  exactLine: string;
  sourceOrdinal: number;
}): string {
  const digest = sha256Hex({
    text: `${IMPORTED_ID_SCHEME}\n${sha256Hex({ text: exactLine })}\n${String(sourceOrdinal)}`,
  });
  return `steer-legacy-${digest}`;
}

/**
 * The id a measurement `profile steers judge` records takes.
 *
 * @param uuid a fresh v4 uuid, lower case
 * @returns `steer-event-<uuid>`
 */
export function newSteerEventId({ uuid }: { uuid: string }): string {
  return `steer-event-${uuid}`;
}

/** One line the one-time import writes: kept exactly, at its place in the file. */
export interface ImportedSteerMeasurement {
  readonly eventId: string;
  readonly exactLine: string;
  /** The line's 1-based place in the file, blanks counted — and so its `journal_seq`. */
  readonly sourceOrdinal: number;
}

/**
 * Every nonblank line of the home journal as the measurement the import writes. A line that does not parse is
 * imported too, exactly as it is: it is history, and the reading names it.
 *
 * @param lines the journal's nonblank lines, each at its place in the file
 * @returns the measurements, in file order
 */
export function importedSteerMeasurements({
  lines,
}: {
  lines: readonly WitnessedJournalLine[];
}): readonly ImportedSteerMeasurement[] {
  return lines.map(({ line, number }) => ({
    eventId: importedSteerEventId({ exactLine: line, sourceOrdinal: number }),
    exactLine: line,
    sourceOrdinal: number,
  }));
}

/**
 * What the one-time import writes from one read of the journal: nothing for an absent one, every line with the
 * file's witness for a present one.
 *
 * @param file the read
 * @returns the import source
 */
export function steerMeasurementImportSource({
  file,
}: {
  file: WitnessedJournal;
}): ImportSource<ImportedSteerMeasurement> {
  if (file.state === "absent") {
    return { state: "absent" };
  }
  return { records: importedSteerMeasurements({ lines: file.lines }), state: "present", witness: file.witness };
}

/** One row as the table takes it. */
export interface SteerMeasurementInsertRow {
  readonly eventId: string;
  readonly journalSeq: number;
  readonly origin: SteerMeasurementOrigin;
  readonly exactLine: string;
  readonly sourceOrdinal: number | null;
}

/**
 * The rows the one-time import inserts: each line at its own place in the file as its sequence.
 *
 * @param records the journal's lines, in file order
 * @returns the rows
 */
export function importedSteerMeasurementRows({
  records,
}: {
  records: readonly ImportedSteerMeasurement[];
}): readonly SteerMeasurementInsertRow[] {
  return records.map((record) => ({
    eventId: record.eventId,
    exactLine: record.exactLine,
    journalSeq: record.sourceOrdinal,
    origin: "legacy-file",
    sourceOrdinal: record.sourceOrdinal,
  }));
}

/** One stored measurement, as a read takes it. */
export interface StoredSteerMeasurement {
  readonly eventId: string;
  readonly journalSeq: number;
  readonly origin: SteerMeasurementOrigin;
  readonly exactLine: string;
  /** Its 1-based place in the file it came from, carried exactly when its id is a legacy one. */
  readonly sourceOrdinal: number | null;
}

/**
 * The stored lines as the history `profile steers` folds: every verdict that reads, and the sequence of every line
 * that does not.
 *
 * @param measurements every stored measurement, in `journal_seq` order
 * @returns the history
 */
export function steerHistoryOf({ measurements }: { measurements: readonly StoredSteerMeasurement[] }): SteerHistory {
  return parseNumberedSteerVerdicts({
    lines: measurements.map((measurement) => ({ line: measurement.exactLine, number: measurement.journalSeq })),
  });
}

/**
 * The sequence the next appended line takes: one past the highest stored, or 1 on an empty register.
 *
 * @param highest the highest stored `journal_seq`, or `null` when none is stored
 * @returns the next sequence
 */
export function nextSteerJournalSeq({ highest }: { highest: number | null }): number {
  if (highest === null) {
    return 1;
  }
  return highest + 1;
}

/**
 * The row one judged verdict appends, refused when its line would not read back as that verdict: the types admit
 * values the grammar does not (a kind that is not a Slack steer kind, an instant that is not ISO), and a line the
 * reader refuses would be history nobody could read.
 *
 * @param verdict what was judged
 * @param journalSeq the sequence it takes
 * @param uuid a fresh uuid for its id
 * @returns the row, or the refusal
 */
export function steerAppendRow({
  verdict,
  journalSeq,
  uuid,
}: {
  verdict: SteerVerdict;
  journalSeq: number;
  uuid: string;
}): Result<SteerMeasurementInsertRow, SteerMeasurementError> {
  const exactLine = steerVerdictLine({ verdict });
  if (steerVerdictOf({ line: exactLine }) === undefined) {
    return err(SteerMeasurementErrors.writeUnreadable({ why: "the journal's own grammar does not read it" }));
  }
  return ok({ eventId: newSteerEventId({ uuid }), exactLine, journalSeq, origin: "profile", sourceOrdinal: null });
}

/**
 * Judge the marker as a reading snapshot counted it, after the one-time import already ran: a missing marker means
 * that import was undone, and any count but the marker's means imported lines were lost or imported twice — either
 * way the snapshot is not the register.
 *
 * @param marker the marker and its counted lines, read inside the snapshot, or undefined when none stands
 * @returns the refusal, or undefined when the snapshot may stand
 */
export function steerMarkerRefusal({
  marker,
}: {
  marker: ImportMarker | undefined;
}): SteerMeasurementError | undefined {
  if (marker === undefined) {
    return SteerMeasurementErrors.storeUnavailable({
      doing: "read the steer-measurement import marker inside the reading snapshot",
      reason: "the marker the import wrote is gone",
    });
  }
  const refused = markerRefusal({ marker });
  if (refused === undefined) {
    return undefined;
  }
  return SteerMeasurementErrors.importMarkerInconsistent(refused.markerInconsistency);
}

/** What every legacy id opens with, whichever writer stored it. */
const IMPORTED_ID_PREFIX = "steer-legacy-";

/**
 * Whether one stored row is the line, at the place, its legacy id names. A row with a legacy id is checked whoever
 * wrote it — a store import carries the id its source minted, and an export's strict envelope re-derives it — and a
 * `legacy-file` row's place must also be its sequence. A `profile` id is a uuid and binds no line.
 *
 * @param measurement the stored row
 * @returns false when the row is not what its id names
 */
function importedRowIntact({ measurement }: { measurement: StoredSteerMeasurement }): boolean {
  if (!measurement.eventId.startsWith(IMPORTED_ID_PREFIX)) {
    return measurement.origin !== "legacy-file";
  }
  if (measurement.sourceOrdinal === null) {
    return false;
  }
  if (measurement.origin === "legacy-file" && measurement.sourceOrdinal !== measurement.journalSeq) {
    return false;
  }
  return (
    measurement.eventId ===
    importedSteerEventId({ exactLine: measurement.exactLine, sourceOrdinal: measurement.sourceOrdinal })
  );
}

/**
 * The first row carrying a legacy id that is not the one its own line and place mint: a line edited, a row swapped
 * for another, two rows moved behind the triggers, or a store-import row stored under an id its line never minted.
 * Re-derived on every read because the marker only COUNTS imported rows, so a change that keeps the count would
 * otherwise read as the register, and because a row that read here but not in an export's envelope would be history
 * no export could carry. The residue, stated: whoever may disable the triggers may also insert or replace a row
 * under an id this public scheme mints for its line, relabelling or moving any other to keep the count, and the
 * marker never notices — it witnesses the home file and the count, never the stored lines. A digest of the rows kept beside it
 * would not close that either: the same writer can rewrite the digest. The triggers are the guard.
 *
 * @param measurements every stored measurement, in `journal_seq` order
 * @returns the refusal, or undefined when every legacy-id row is the line its id names
 */
export function steerImportedRowRefusal({
  measurements,
}: {
  measurements: readonly StoredSteerMeasurement[];
}): SteerMeasurementError | undefined {
  const altered = measurements.find((measurement) => !importedRowIntact({ measurement }));
  if (altered === undefined) {
    return undefined;
  }
  return SteerMeasurementErrors.importedRowAltered({ journalSeq: altered.journalSeq });
}

/**
 * Judge one reading snapshot whole: the counted marker first, then every imported row against its own id.
 *
 * @param marker the marker and its counted lines, read inside the snapshot, or undefined when none stands
 * @param measurements every stored measurement the snapshot read, in `journal_seq` order
 * @returns the refusal, or undefined when the snapshot is the register
 */
export function steerSnapshotRefusal({
  marker,
  measurements,
}: {
  marker: ImportMarker | undefined;
  measurements: readonly StoredSteerMeasurement[];
}): SteerMeasurementError | undefined {
  const refused = steerMarkerRefusal({ marker });
  if (refused !== undefined) {
    return refused;
  }
  return steerImportedRowRefusal({ measurements });
}

/**
 * A store step that did not finish, in this register's terms: a marker contradicting its table names both counts,
 * anything else is an outage.
 *
 * @param doing what the step was for
 * @param reason what the driver said
 * @param markerInconsistency the two counts, when the step was trusting a marker its table contradicts
 * @returns the typed error
 */
export function steerStepFailure({
  doing,
  reason,
  markerInconsistency,
}: {
  readonly doing: string;
  readonly reason: string;
  readonly markerInconsistency?: { readonly expected: number; readonly observed: number };
}): SteerMeasurementError {
  if (markerInconsistency !== undefined) {
    return SteerMeasurementErrors.importMarkerInconsistent(markerInconsistency);
  }
  return SteerMeasurementErrors.storeUnavailable({ doing, reason });
}
