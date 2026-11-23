/**
 * The one door the landing-read cursor is read and written through, and its orchestration over injected seams.
 *
 * The `landing_read_cursor` table is the authority (`../store/schema/landingReadCursor.ts`). The old
 * `landing-reads.json` is imported ONCE by the shared protocol in `../store/registerImport.ts`, on the first
 * operation of any connection, read or write. A store that cannot be reached is `READ_STORE_UNAVAILABLE`, never
 * a file read and never "no read recorded": an unknown cadence answered as `due` would read every tick for as
 * long as the store is down, and answered as `skip` would be the measured failure this register exists to end.
 *
 * Every effect arrives through {@link ReadJournalSeams}, so a unit test drives every branch over a plain
 * in-memory fake (`src/__tests__/landingRegistersFixture.ts` — a seam, not a mock). The Postgres half and the
 * production factory are `./readJournalStoreRows.ts`; what only a real database can prove is the opt-in
 * `src/__tests__/integration/landingRegistersStore.test.ts`.
 *
 * ## One compare-and-set attempt, never retried
 *
 * A record reads the selection's row and writes against its revision: no row inserts revision 1, a row at
 * revision N updates `WHERE revision = N` to N + 1. Another writer landing between the two is
 * `READ_REVISION_CONFLICT`, and the port does not try again — a later read standing over an earlier one is
 * the newer fact, and a retry would overwrite it with the older.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  confirmEmptyRead,
  ensureImported,
  type ImportOnceRows,
  type ImportSource,
  overConnection,
  type StoreStepFailure,
} from "../store/registerImport.js";

import { decodeReadRecord, type ReadRecord } from "./readJournal.js";
import { type ReadJournalError, ReadJournalErrors, type ReadStoreUnavailableError } from "./readJournalErrors.js";

/** The cursor's two operations, as one value a caller threads. */
export interface ReadJournalPort {
  /** The latest completed read per selection. */
  readonly readLatest: (request: {
    readonly home: string;
  }) => Promise<Result<ReadonlyMap<string, ReadRecord>, ReadJournalError>>;
  /** Record one completed read, in one compare-and-set attempt. */
  readonly record: (request: {
    readonly home: string;
    readonly record: ReadRecord;
  }) => Promise<Result<ReadRecord, ReadJournalError>>;
}

/** One stored cursor row as the store returned it, undecoded. */
export interface StoredRead {
  readonly selection: string;
  readonly atIso: string;
  readonly rows: number;
  readonly dispatchable: number;
  readonly revision: number;
}

/** The row operations one open connection offers, and the handle that closes it. */
export interface ReadJournalRows extends ImportOnceRows<ReadRecord> {
  /** Every stored selection's row. */
  readonly readAll: () => Promise<Result<readonly StoredRead[], StoreStepFailure>>;
  /** One selection's row, or undefined. */
  readonly readSelection: (request: {
    readonly selection: string;
  }) => Promise<Result<StoredRead | undefined, StoreStepFailure>>;
  /** Insert at revision 1 unless the selection has a row; undefined when it did. */
  readonly insertFirst: (request: {
    readonly record: ReadRecord;
  }) => Promise<Result<StoredRead | undefined, StoreStepFailure>>;
  /**
   * Update iff the row is still exactly `expected`, every column, moving it to the next revision; undefined when
   * it was not. The whole row, not the revision alone, so a row changed after it was checked is never written over.
   */
  readonly updateAt: (request: {
    readonly record: ReadRecord;
    readonly expected: StoredRead;
  }) => Promise<Result<StoredRead | undefined, StoreStepFailure>>;
  readonly close: () => Promise<void>;
}

/** Every effect the cursor performs. */
export interface ReadJournalSeams {
  /** Open the store for one home, refusing with `READ_STORE_UNAVAILABLE` when it cannot be. */
  readonly connect: (request: { readonly home: string }) => Promise<Result<ReadJournalRows, ReadStoreUnavailableError>>;
  /** The strict read of the old file, consulted only when no import marker exists. */
  readonly readImportFile: (request: { readonly home: string }) => Result<ImportSource<ReadRecord>, ReadJournalError>;
}

/**
 * Decode one stored row strictly.
 *
 * @param row the row
 * @returns the record, or the corrupt row named
 */
function decodeStored({ row }: { row: StoredRead }): Result<ReadRecord, ReadJournalError> {
  // The revision is what every compare-and-set write is keyed on, so one that is not positive is corrupt too.
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) {
    return err(
      ReadJournalErrors.recordInvalid({
        reason: `carries revision ${String(row.revision)}, which is not a positive whole number`,
        selection: row.selection,
      }),
    );
  }
  return decodeReadRecord({ entry: row, selection: row.selection }).mapErr((problem) =>
    ReadJournalErrors.recordInvalid({ reason: problem.message, selection: row.selection }),
  );
}

/**
 * Whether the row a write answered with is exactly the read it was sent, at the revision it should now be at.
 *
 * @param answered the row the store returned
 * @param sent the read that was written
 * @param revision the revision the write moves the row to
 * @returns true when every column agrees
 */
function answeredAsSent({
  answered,
  sent,
  revision,
}: {
  answered: StoredRead;
  sent: ReadRecord;
  revision: number;
}): boolean {
  return (
    answered.selection === sent.selection &&
    answered.atIso === sent.atIso &&
    answered.rows === sent.rows &&
    answered.dispatchable === sent.dispatchable &&
    answered.revision === revision
  );
}

/**
 * Run the one-time import over an open connection.
 *
 * @param home whose file is the import source
 * @param rows the open connection
 * @param seams where the file read comes from
 * @returns nothing once the table is the whole register, or the refusal
 */
async function imported({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: ReadJournalRows;
  seams: ReadJournalSeams;
}): Promise<Result<undefined, ReadJournalError>> {
  return ensureImported({
    readSource: () => seams.readImportFile({ home }),
    rows,
    unavailable: ReadJournalErrors.storeUnavailable,
  });
}

/**
 * Read the latest read per selection.
 *
 * @param home the Slopweaver home whose store and old file are meant
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the map, or the refusal
 */
async function readLatestWith({
  home,
  rows,
  seams,
}: {
  home: string;
  rows: ReadJournalRows;
  seams: ReadJournalSeams;
}): Promise<Result<ReadonlyMap<string, ReadRecord>, ReadJournalError>> {
  const ready = await imported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const stored = await rows.readAll();
  if (stored.isErr()) {
    return err(ReadJournalErrors.storeUnavailable(stored.error));
  }
  const held = await confirmEmptyRead({
    rowCount: stored.value.length,
    rows,
    unavailable: ReadJournalErrors.storeUnavailable,
  });
  if (held.isErr()) {
    return err(held.error);
  }
  const reads = new Map<string, ReadRecord>();
  for (const row of stored.value) {
    const decoded = decodeStored({ row });
    if (decoded.isErr()) {
      return err(decoded.error);
    }
    reads.set(decoded.value.selection, decoded.value);
  }
  return ok(reads);
}

/**
 * Check the row a write is about to replace. A corrupt current row is refused, never written over: replacing it
 * would bury the only evidence of it.
 *
 * @param current the stored row for the selection, absent before its first read
 * @param selection the selection the write is for, which that row must carry
 * @returns nothing when the write may proceed, or the refusal
 */
function checkedCurrent({
  current,
  selection,
}: {
  current: StoredRead | undefined;
  selection: string;
}): Result<undefined, ReadJournalError> {
  if (current === undefined) {
    return ok(undefined);
  }
  const stored = decodeStored({ row: current });
  if (stored.isErr()) {
    return err(stored.error);
  }
  if (current.selection !== selection) {
    return err(ReadJournalErrors.recordInvalid({ reason: "came back from the store as another selection", selection }));
  }
  return ok(undefined);
}

/**
 * Record one completed read in one compare-and-set attempt.
 *
 * @param home the Slopweaver home whose store and old file are meant
 * @param record the read
 * @param rows the open connection
 * @param seams the remaining effects
 * @returns the record as stored, or the refusal
 */
async function recordWith({
  home,
  record,
  rows,
  seams,
}: {
  home: string;
  record: ReadRecord;
  rows: ReadJournalRows;
  seams: ReadJournalSeams;
}): Promise<Result<ReadRecord, ReadJournalError>> {
  // The caller's selection is read once; from the decode on, only the checked copy is used.
  const asked = record.selection;
  const valid = decodeReadRecord({ entry: record, selection: asked });
  if (valid.isErr()) {
    return err(ReadJournalErrors.recordInvalid({ reason: valid.error.message, selection: asked }));
  }
  const { selection } = valid.value;
  const ready = await imported({ home, rows, seams });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const current = await rows.readSelection({ selection });
  if (current.isErr()) {
    return err(ReadJournalErrors.storeUnavailable(current.error));
  }
  const checked = checkedCurrent({ current: current.value, selection });
  if (checked.isErr()) {
    return err(checked.error);
  }
  const expectedRevision = current.value === undefined ? 0 : current.value.revision;
  const written =
    current.value === undefined
      ? await rows.insertFirst({ record: valid.value })
      : await rows.updateAt({ expected: current.value, record: valid.value });
  if (written.isErr()) {
    return err(ReadJournalErrors.storeUnavailable(written.error));
  }
  if (written.value === undefined) {
    return err(ReadJournalErrors.revisionConflict({ expectedRevision, selection }));
  }
  // The row the store answers with must be the read that was sent, at the revision after the one checked.
  if (!answeredAsSent({ answered: written.value, revision: expectedRevision + 1, sent: valid.value })) {
    return err(ReadJournalErrors.recordInvalid({ reason: "came back from its write altered", selection }));
  }
  return decodeStored({ row: written.value });
}

/**
 * A cursor port whose authority is the store, over whichever seams it is handed.
 *
 * @param seams the effects — production's are `./readJournalStoreRows.ts`'s
 * @returns the port
 */
export function storeReadJournalPort({ seams }: { seams: ReadJournalSeams }): ReadJournalPort {
  return {
    readLatest: ({ home }) =>
      overConnection({
        body: (rows) => readLatestWith({ home, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: ReadJournalErrors.storeUnavailable,
      }),
    record: ({ home, record }) =>
      overConnection({
        body: (rows) => recordWith({ home, record, rows, seams }),
        connect: () => seams.connect({ home }),
        unavailable: ReadJournalErrors.storeUnavailable,
      }),
  };
}
