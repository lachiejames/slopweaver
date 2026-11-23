/**
 * An in-memory steer-measurement store: the seams `storeSteerMeasurementPort` runs over, kept as a plain array so a
 * unit test drives every branch of the port — the one-time import, its witness, the counted marker, the appends and
 * every refusal — with no database and no mock. A seam, not a mock: the fake keeps the invariants the Postgres half
 * keeps (one row per sequence, nothing changed or deleted, the marker claimed once), and what only a real database
 * can prove is `integration/steerMeasurementStore.test.ts`.
 *
 * The home journal is read by the REAL reader under the test's own home unless a test hands one in, so the link and
 * torn-byte refusals are the shipped ones. Every field of {@link SteerMeasurementFakeState} is mutable on purpose.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type SteerMeasurementError, SteerMeasurementErrors } from "../profile/steerMeasurementErrors.js";
import type {
  SteerMeasurementPort,
  SteerMeasurementRows,
  SteerMeasurementStoreSeams,
} from "../profile/steerMeasurementPort.js";
import {
  importedSteerMeasurementRows,
  nextSteerJournalSeq,
  type SteerMeasurementInsertRow,
  type StoredSteerMeasurement,
  steerAppendRow,
  steerSnapshotRefusal,
} from "../profile/steerMeasurementRecords.js";
import { readHomeFileSteerMeasurements } from "../profile/steerMeasurementRows.js";
import { storeSteerMeasurementPort } from "../profile/steerMeasurementStore.js";
import type { ImportMarker, MarkedSource } from "../store/registerImport.js";
import type { WitnessedJournal } from "../store/witnessedJournal.js";

/** How the fake's `connect` answers. */
export type SteerMeasurementFakeConnection = "open" | "unselected" | "unavailable";

/**
 * The fake's whole state — every field a test may read or move.
 *
 * @internal
 */
export interface SteerMeasurementFakeState {
  rows: SteerMeasurementInsertRow[];
  /** The import marker: its claimed count and what it recorded of the file, or undefined when none ran. */
  marker: { readonly records: number; readonly source: MarkedSource } | undefined;
  connection: SteerMeasurementFakeConnection;
  /** When set, the next append meets the sequence index as if a racing appender had committed first. */
  raceNextAppend: boolean;
  homeFileReads: number;
  closes: number;
  nextUuid: number;
}

/** A fake store and the port over it. */
export interface SteerMeasurementFake {
  readonly state: SteerMeasurementFakeState;
  readonly seams: SteerMeasurementStoreSeams;
  readonly port: SteerMeasurementPort;
}

/**
 * The marker as the counted probe reads it.
 *
 * @param state the fake
 * @returns the marker and its observed count, or undefined when no import has run
 */
function markerOf({ state }: { state: SteerMeasurementFakeState }): ImportMarker | undefined {
  if (state.marker === undefined) {
    return undefined;
  }
  const observedRows = state.rows.filter((row) => row.origin === "legacy-file").length;
  return { observedRows, records: state.marker.records, tableHasRows: observedRows > 0 };
}

/**
 * Every row in sequence order, as a read takes it.
 *
 * @param state the fake
 * @returns the stored measurements
 */
function storedOf({ state }: { state: SteerMeasurementFakeState }): readonly StoredSteerMeasurement[] {
  return state.rows
    .toSorted((a, b) => a.journalSeq - b.journalSeq)
    .map((row) => ({
      eventId: row.eventId,
      exactLine: row.exactLine,
      journalSeq: row.journalSeq,
      origin: row.origin,
      sourceOrdinal: row.sourceOrdinal,
    }));
}

/**
 * One append, the way the Postgres half's transaction makes it.
 *
 * @param state the fake
 * @param verdict what was judged
 * @returns what was written, or the refusal
 */
function appendTo({
  state,
  verdict,
}: {
  state: SteerMeasurementFakeState;
  verdict: Parameters<SteerMeasurementRows["append"]>[0]["verdict"];
}): Result<{ readonly kind: "written"; readonly eventId: string; readonly journalSeq: number }, SteerMeasurementError> {
  if (state.raceNextAppend) {
    state.raceNextAppend = false;
    return err(SteerMeasurementErrors.appendConflict({ reason: "a racing appender committed first" }));
  }
  const seqs = state.rows.map((row) => row.journalSeq);
  const highest = seqs.length === 0 ? null : Math.max(...seqs);
  state.nextUuid += 1;
  const uuid = `00000000-0000-4000-8000-${String(state.nextUuid).padStart(12, "0")}`;
  const row = steerAppendRow({ journalSeq: nextSteerJournalSeq({ highest }), uuid, verdict });
  if (row.isErr()) {
    return err(row.error);
  }
  state.rows.push(row.value);
  return ok({ eventId: row.value.eventId, journalSeq: row.value.journalSeq, kind: "written" });
}

/**
 * The row operations over the fake's state.
 *
 * @param state the fake
 * @returns the rows one "connection" offers
 */
function rowsOver({ state }: { state: SteerMeasurementFakeState }): SteerMeasurementRows {
  return {
    append: async ({ verdict }) => appendTo({ state, verdict }),
    claim: async ({ source }) => {
      if (state.marker !== undefined) {
        return ok(false);
      }
      const records = source.state === "present" ? source.records : [];
      let marked: MarkedSource = { state: "absent" };
      if (source.state === "present") {
        // The production reader always records a witness, so a source without one marks a present file unwitnessed.
        marked = { state: "present", witness: unsetFieldAsNull({ key: "witness", record: source }) };
      }
      state.marker = { records: records.length, source: marked };
      state.rows.push(...importedSteerMeasurementRows({ records }));
      return ok(true);
    },
    close: async () => {
      state.closes += 1;
    },
    markedSource: async () => ok(state.marker?.source),
    marker: async () => ok(markerOf({ state })),
    readStored: async () => {
      const measurements = storedOf({ state });
      const refused = steerSnapshotRefusal({ marker: markerOf({ state }), measurements });
      if (refused !== undefined) {
        return err(refused);
      }
      return ok(measurements);
    },
  };
}

/**
 * A fresh fake store, empty and open.
 *
 * @param connection how `connect` answers
 * @param readHomeFile the journal read — the real one under the given home unless a test hands one in
 * @returns the state, the seams and the port over them
 */
export function steerMeasurementFake({
  connection = "open",
  readHomeFile = readHomeFileSteerMeasurements,
}: {
  connection?: SteerMeasurementFakeConnection;
  readHomeFile?: (request: { readonly home: string }) => Result<WitnessedJournal, SteerMeasurementError>;
} = {}): SteerMeasurementFake {
  const state: SteerMeasurementFakeState = {
    closes: 0,
    connection,
    homeFileReads: 0,
    marker: undefined,
    nextUuid: 0,
    raceNextAppend: false,
    rows: [],
  };
  const seams: SteerMeasurementStoreSeams = {
    connect: async () => {
      if (state.connection === "unselected") {
        return err(
          SteerMeasurementErrors.storeUnselected({ needed: "need a store", selection: "no store is configured" }),
        );
      }
      if (state.connection === "unavailable") {
        return err(SteerMeasurementErrors.storeUnavailable({ doing: "be opened", reason: "connection refused" }));
      }
      return ok(rowsOver({ state }));
    },
    readHomeFile: (request) => {
      state.homeFileReads += 1;
      return readHomeFile(request);
    },
  };
  return { port: storeSteerMeasurementPort({ seams }), seams, state };
}
