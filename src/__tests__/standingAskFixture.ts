/**
 * An in-memory standing-ask store: the seams `storeStandingAskPort` runs over, kept as plain arrays so a unit test
 * drives every branch of the port — the one-time import, its witness, the counted marker, the locked writes and
 * every refusal — with no database and no mock. A seam, not a mock: the fake keeps the invariants the Postgres half
 * keeps (one active generation per id and per card, one event per sequence, nothing deleted, the marker claimed
 * once), and what only a real database can prove is `integration/standingAskStore.test.ts`.
 *
 * The home journal is read by the REAL reader under the test's own home unless a test hands one in, so the link
 * and torn-byte refusals are the shipped ones. Every field of {@link StandingAskFakeState} is mutable on purpose.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";

import { type StandingAskError, StandingAskErrors } from "../profile/standingAskErrors.js";
import { readHomeFileStandingAsks } from "../profile/standingAskImport.js";
import type {
  StandingAskHomeFile,
  StandingAskPort,
  StandingAskRows,
  StandingAskStoreSeams,
} from "../profile/standingAskPort.js";
import {
  importedStandingAskRows,
  type StandingAskInsertRows,
  type StoredStandingAsk,
  type StoredStandingAskCoverage,
  type StoredStandingAskEvent,
  type StoredStandingAsks,
} from "../profile/standingAskRecords.js";
import { storeStandingAskPort } from "../profile/standingAskStore.js";
import { lockedStandingAskWrite, standingAskSnapshotOver } from "../profile/standingAskWrites.js";
import type { ImportMarker, MarkedSource } from "../store/registerImport.js";

/** How the fake's `connect` answers. */
export type StandingAskFakeConnection = "open" | "unselected" | "unavailable";

/**
 * The fake's whole state — every field a test may read or move.
 *
 * @internal
 */
export interface StandingAskFakeState {
  asks: StoredStandingAsk[];
  coverage: StoredStandingAskCoverage[];
  events: StoredStandingAskEvent[];
  /** The import marker: its claimed count and what it recorded of the file, or undefined when none ran. */
  marker: { readonly records: number; readonly source: MarkedSource } | undefined;
  connection: StandingAskFakeConnection;
  /** When set, the next write meets an index as if a racing writer had committed first. */
  raceNextWrite: boolean;
  homeFileReads: number;
  closes: number;
  nextRow: number;
}

/** A fake store and the port over it. */
export interface StandingAskFake {
  readonly state: StandingAskFakeState;
  readonly seams: StandingAskStoreSeams;
  readonly port: StandingAskPort;
}

/**
 * The next synthetic row id.
 *
 * @param state the fake, whose counter advances
 * @returns a fresh row id
 */
function nextRowId({ state }: { state: StandingAskFakeState }): string {
  state.nextRow += 1;
  return `row-${String(state.nextRow)}`;
}

/**
 * Insert rows, refusing what the Postgres half's indexes refuse.
 *
 * @param state the fake
 * @param rows what to insert
 */
function insertRows({ state, rows }: { state: StandingAskFakeState; rows: StandingAskInsertRows }): void {
  const activeIds = new Set(state.asks.filter((ask) => ask.state === "active").map((ask) => ask.askId));
  const activeCovers = new Set(state.coverage.filter((row) => row.state === "active").map((row) => row.coverage));
  const seqs = new Set(state.events.map((event) => event.journalSeq));
  const clash =
    rows.asks.some((ask) => ask.state === "active" && activeIds.has(ask.askId)) ||
    rows.coverage.some((row) => row.state === "active" && activeCovers.has(row.coverage)) ||
    rows.events.some((event) => seqs.has(event.journalSeq));
  if (clash) {
    throw new Error("duplicate key value violates a standing-ask unique index");
  }
  state.asks.push(...rows.asks);
  state.coverage.push(...rows.coverage);
  state.events.push(...rows.events);
}

/**
 * The marker as the counted probe reads it.
 *
 * @param state the fake
 * @returns the marker and its observed count, or undefined when no import has run
 */
function markerOf({ state }: { state: StandingAskFakeState }): ImportMarker | undefined {
  if (state.marker === undefined) {
    return undefined;
  }
  const observedRows = state.events.filter((event) => event.origin === "legacy-file").length;
  return { observedRows, records: state.marker.records, tableHasRows: observedRows > 0 };
}

/**
 * One reading snapshot.
 *
 * @param state the fake
 * @returns the register, or the marker's refusal
 */
async function snapshotOf({
  state,
}: {
  state: StandingAskFakeState;
}): Promise<Result<StoredStandingAsks, StandingAskError>> {
  return standingAskSnapshotOver({
    readMarker: async () => markerOf({ state }),
    readRows: async () => ({
      asks: [...state.asks],
      coverage: [...state.coverage],
      events: [...state.events],
    }),
  });
}

/**
 * The row operations over the fake's state.
 *
 * @param state the fake
 * @returns the rows one "connection" offers
 */
function rowsOver({ state }: { state: StandingAskFakeState }): StandingAskRows {
  return {
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
      insertRows({ rows: importedStandingAskRows({ events: records, mintId: () => nextRowId({ state }) }), state });
      return ok(true);
    },
    close: async () => {
      state.closes += 1;
    },
    markedSource: async () => ok(state.marker?.source),
    marker: async () => ok(markerOf({ state })),
    readStored: () => snapshotOf({ state }),
    write: async ({ decide }) => {
      try {
        return await lockedStandingAskWrite({
          apply: async ({ rows }) => {
            if (state.raceNextWrite) {
              state.raceNextWrite = false;
              throw new Error("a racing writer committed first");
            }
            const retired = rows.withdrawRowId;
            if (retired !== undefined) {
              state.asks = state.asks.map((ask) => (ask.rowId === retired ? { ...ask, state: "withdrawn" } : ask));
              state.coverage = state.coverage.map((row) =>
                row.askRowId === retired ? { ...row, state: "withdrawn" } : row,
              );
            }
            insertRows({ rows, state });
          },
          decide,
          lock: async () => undefined,
          mintId: () => nextRowId({ state }),
          read: () => snapshotOf({ state }),
        });
      } catch (cause) {
        return err(StandingAskErrors.writeConflict({ reason: cause instanceof Error ? cause.message : "unknown" }));
      }
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
export function standingAskFake({
  connection = "open",
  readHomeFile = readHomeFileStandingAsks,
}: {
  connection?: StandingAskFakeConnection;
  readHomeFile?: (request: { readonly home: string }) => Result<StandingAskHomeFile, StandingAskError>;
} = {}): StandingAskFake {
  const state: StandingAskFakeState = {
    asks: [],
    closes: 0,
    connection,
    coverage: [],
    events: [],
    homeFileReads: 0,
    marker: undefined,
    nextRow: 0,
    raceNextWrite: false,
  };
  const seams: StandingAskStoreSeams = {
    connect: async () => {
      if (state.connection === "unselected") {
        return err(StandingAskErrors.storeUnselected({ needed: "need a store", selection: "no store is configured" }));
      }
      if (state.connection === "unavailable") {
        return err(StandingAskErrors.storeUnavailable({ doing: "be opened", reason: "connection refused" }));
      }
      return ok(rowsOver({ state }));
    },
    readHomeFile: (request) => {
      state.homeFileReads += 1;
      return readHomeFile(request);
    },
  };
  return { port: storeStandingAskPort({ seams }), seams, state };
}
