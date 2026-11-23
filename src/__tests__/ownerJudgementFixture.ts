/**
 * An in-memory owner-judgement store: the seams `storeOwnerDirectivePort` runs over, kept as plain arrays so a
 * unit test drives every branch of the port — the one-time import, the counted marker, the versioned writes and
 * every refusal — with no database and no mock. A seam, not a mock: the fake keeps the same invariants the
 * Postgres half keeps (one active version per id, versions never deleted, the marker claimed once), and what only
 * a real database can prove is `integration/ownerJudgementStore.test.ts`.
 *
 * Every field of {@link OwnerJudgementFake.state} is mutable on purpose: a test changes the legacy file between
 * two calls, deletes rows behind a marker, or switches the connection to an outage, and asserts what the port does.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "../judgement/ownerDirective.errors.js";
import type {
  OwnerDirectivePort,
  OwnerDirectiveStoreSeams,
  OwnerJudgementRows,
} from "../judgement/ownerDirectivePort.js";
import { storeOwnerDirectivePort } from "../judgement/ownerDirectiveStore.js";
import {
  correctionRowOf,
  directiveRowOf,
  type OwnerJudgementOrigin,
  type OwnerJudgementRecord,
  type OwnerJudgementTransition,
  type StoredOwnerCorrection,
  type StoredOwnerDirective,
  type StoredOwnerJudgement,
  snapshotMarkerRefusal,
} from "../judgement/ownerJudgementRecords.js";
import type { ImportMarker, ImportSource } from "../store/registerImport.js";

/** How the fake's `connect` answers. */
export type FakeConnection = "open" | "unselected" | "unavailable" | "throws";

/**
 * The fake's whole state — every field a test may read or move.
 *
 * @internal
 */
export interface OwnerJudgementFakeState {
  directives: StoredOwnerDirective[];
  corrections: StoredOwnerCorrection[];
  /** The import marker's claimed record count, or undefined when no import has run. */
  marker: number | undefined;
  /** What the legacy file read answers. */
  legacy: Result<ImportSource<OwnerJudgementRecord>, OwnerDirectiveError>;
  connection: FakeConnection;
  /** When set, `readStored` fails with this driver reason. */
  readFailure: string | undefined;
  /**
   * How many `legacy-file` rows the next reading snapshot loses just before it reads — a deletion committed after
   * the import was checked and before the rows were read, the race the snapshot's re-count exists for.
   */
  loseBeforeRead: number;
  legacyReads: number;
  connects: number;
  closes: number;
  nextRow: number;
}

/** A fake store and the port over it. */
export interface OwnerJudgementFake {
  readonly state: OwnerJudgementFakeState;
  readonly seams: OwnerDirectiveStoreSeams;
  readonly port: OwnerDirectivePort;
}

/** The legacy read of a home with no file. */
const ABSENT_LEGACY: Result<ImportSource<OwnerJudgementRecord>, OwnerDirectiveError> = ok({ state: "absent" });

/**
 * The next synthetic row id.
 *
 * @param state the fake, whose counter advances
 * @returns a fresh row id
 */
function nextRowId({ state }: { state: OwnerJudgementFakeState }): string {
  state.nextRow += 1;
  return `row-${state.nextRow}`;
}

/**
 * Insert records as active versions, the way the Postgres half does, each naming the writer that produced it.
 *
 * @param state the fake
 * @param records the directives and corrections to insert
 * @param origin `legacy-file` for the import, `memory` for a memory event's activations
 */
function insertRecords({
  state,
  records,
  origin,
}: {
  state: OwnerJudgementFakeState;
  records: readonly OwnerJudgementRecord[];
  origin: OwnerJudgementOrigin;
}): void {
  for (const record of records) {
    if (record.kind === "directive") {
      state.directives.push({
        ...directiveRowOf({ directive: record.directive, origin, state: "active" }),
        rowId: nextRowId({ state }),
      });
    } else {
      state.corrections.push({
        ...correctionRowOf({ correction: record.correction, origin, state: "active" }),
        rowId: nextRowId({ state }),
      });
    }
  }
}

/**
 * The rows the one-time import wrote, in either state — what the Postgres probe counts.
 *
 * @param state the fake
 * @returns how many `legacy-file` versions both tables hold
 */
function legacyFileRows({ state }: { state: OwnerJudgementFakeState }): number {
  return [...state.directives, ...state.corrections].filter((row) => row.origin === "legacy-file").length;
}

/**
 * Apply one planned transition: retire, then activate, refusing a second active version per id.
 *
 * @param state the fake
 * @param transition what the plan decided
 */
function applyTransition({
  state,
  transition,
}: {
  state: OwnerJudgementFakeState;
  transition: OwnerJudgementTransition;
}): void {
  state.directives = state.directives.map((row) =>
    row.state === "active" && transition.retireDirectives.includes(row.directiveId)
      ? { ...row, state: "inactive" }
      : row,
  );
  state.corrections = state.corrections.map((row) =>
    row.state === "active" && transition.retireCorrections.includes(row.correctionId)
      ? { ...row, state: "inactive" }
      : row,
  );
  insertRecords({
    records: [
      ...transition.activateDirectives.map((directive): OwnerJudgementRecord => ({ directive, kind: "directive" })),
      ...transition.activateCorrections.map((correction): OwnerJudgementRecord => ({ correction, kind: "correction" })),
    ],
    origin: "memory",
    state,
  });
}

/**
 * The active versions, as the Postgres read orders them.
 *
 * @param state the fake
 * @returns both tables' active versions
 */
function activeOf({ state }: { state: OwnerJudgementFakeState }): StoredOwnerJudgement {
  return {
    corrections: state.corrections.filter((row) => row.state === "active"),
    directives: state.directives.filter((row) => row.state === "active"),
  };
}

/**
 * The marker as the counted probe reads it, or undefined when no import has run.
 *
 * @param state the fake
 * @returns the marker and its observed count
 */
function markerOf({ state }: { state: OwnerJudgementFakeState }): ImportMarker | undefined {
  if (state.marker === undefined) {
    return undefined;
  }
  const observedRows = legacyFileRows({ state });
  return { observedRows, records: state.marker, tableHasRows: observedRows > 0 };
}

/**
 * One reading snapshot, the way the Postgres half reads one: lose whatever the test scheduled, read the active
 * versions, then re-count the import's rows against the marker.
 *
 * @param state the fake
 * @returns the active versions, or the marker's refusal
 */
function snapshotOf({ state }: { state: OwnerJudgementFakeState }): Result<StoredOwnerJudgement, OwnerDirectiveError> {
  const lost = state.loseBeforeRead;
  state.loseBeforeRead = 0;
  const legacy = new Set(state.directives.filter((row) => row.origin === "legacy-file").slice(0, lost));
  state.directives = state.directives.filter((row) => !legacy.has(row));
  const stored = activeOf({ state });
  const refused = snapshotMarkerRefusal({ marker: markerOf({ state }) });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok(stored);
}

/**
 * The row operations over the fake's state.
 *
 * @param state the fake
 * @returns the rows one "connection" offers
 */
function rowsOver({ state }: { state: OwnerJudgementFakeState }): OwnerJudgementRows {
  return {
    claim: async ({ source }) => {
      if (state.marker !== undefined) {
        return ok(false);
      }
      const records = source.state === "present" ? source.records : [];
      state.marker = records.length;
      insertRecords({ origin: "legacy-file", records, state });
      return ok(true);
    },
    close: async () => {
      state.closes += 1;
    },
    marker: async () => ok(markerOf({ state })),
    readStored: async () => {
      if (state.readFailure !== undefined) {
        return err(
          OwnerDirectiveErrors.storeUnavailable({
            doing: "read the active owner directives",
            reason: state.readFailure,
          }),
        );
      }
      return snapshotOf({ state });
    },
    transact: async ({ plan }) => {
      const stored = snapshotOf({ state });
      if (stored.isErr()) {
        return err(stored.error);
      }
      const planned = plan({ stored: stored.value });
      if (planned.isErr()) {
        return err(planned.error);
      }
      applyTransition({ state, transition: planned.value.transition });
      return ok(planned.value.answer);
    },
  };
}

/**
 * The fake's connect seam.
 *
 * @param state the fake
 * @returns the rows, or the configured refusal
 */
async function connectOver({
  state,
}: {
  state: OwnerJudgementFakeState;
}): Promise<Result<OwnerJudgementRows, OwnerDirectiveError>> {
  state.connects += 1;
  if (state.connection === "throws") {
    throw new Error("connection reset by acme-db");
  }
  if (state.connection === "unselected") {
    return err(OwnerDirectiveErrors.storeUnselected({ needed: "need a store", selection: "no store is configured" }));
  }
  if (state.connection === "unavailable") {
    return err(OwnerDirectiveErrors.storeUnavailable({ doing: "be opened", reason: "connection refused" }));
  }
  return ok(rowsOver({ state }));
}

/**
 * A fresh fake store, empty and open, whose legacy file is absent unless a test says otherwise.
 *
 * @param legacy what the legacy file read answers
 * @param connection how `connect` answers
 * @returns the state, the seams and the port over them
 */
export function ownerJudgementFake({
  legacy = ABSENT_LEGACY,
  connection = "open",
}: {
  legacy?: Result<ImportSource<OwnerJudgementRecord>, OwnerDirectiveError>;
  connection?: FakeConnection;
} = {}): OwnerJudgementFake {
  const state: OwnerJudgementFakeState = {
    closes: 0,
    connection,
    connects: 0,
    corrections: [],
    directives: [],
    legacy,
    legacyReads: 0,
    loseBeforeRead: 0,
    marker: undefined,
    nextRow: 0,
    readFailure: undefined,
  };
  const seams: OwnerDirectiveStoreSeams = {
    connect: () => connectOver({ state }),
    readHomeFile: () => {
      state.legacyReads += 1;
      return state.legacy;
    },
  };
  return { port: storeOwnerDirectivePort({ seams }), seams, state };
}
