/**
 * In-memory stores for the three landing registers — the press journal, the read cursor and the Codex
 * supersessions — for unit tests: each REAL store-backed port (`src/review/pressJournalPort.ts`,
 * `src/review/readJournalPort.ts`, `src/codex/supersessionPort.ts`) over plain collections standing in for its
 * table and for its `home_file_import` marker, with the real strict read of the old home file. A seam, not a
 * mock (`.claude/rules/testing.md`): nothing is stubbed out of a module, a plain object of functions is passed
 * where the production one would be.
 *
 * Because the import read is the real file edge, a test that seeds the old file under its throwaway home sees
 * exactly what an install with an empty store sees: the first operation imports it once, and never again. A
 * test may also put a row straight into a store's collection to stand for one a database holds — a corrupt one
 * included. What this cannot prove is anything Postgres decides; the opt-in
 * `integration/landingRegistersStore.test.ts` covers that.
 */
import { SupersessionStoreErrors } from "../codex/supersessionErrors.js";
import type { StoredSupersession, SupersessionPort, SupersessionRows } from "../codex/supersessionPort.js";
import { foldImportedSupersessions, storeSupersessionPort, supersessionColumns } from "../codex/supersessionPort.js";
import { readSupersessionImportFile } from "../codex/supersessionStore.js";
import { err, ok, type Result } from "../lib/result.js";
import { type PressRecord, pressKey } from "../review/pressJournal.js";
import { PressJournalErrors } from "../review/pressJournalErrors.js";
import {
  type PressJournalPort,
  type PressJournalRows,
  type PressJournalSeams,
  type StoredPress,
  storePressJournalPort,
} from "../review/pressJournalPort.js";
import { readPressImportFile } from "../review/pressJournalStoreRows.js";
import type { ReadRecord } from "../review/readJournal.js";
import { ReadJournalErrors } from "../review/readJournalErrors.js";
import {
  type ReadJournalPort,
  type ReadJournalRows,
  type ReadJournalSeams,
  type StoredRead,
  storeReadJournalPort,
} from "../review/readJournalPort.js";
import { readReadImportFile } from "../review/readJournalStoreRows.js";
import type { ImportOnceRows, ImportSource, StoreStepFailure } from "../store/registerImport.js";

/** The connection bookkeeping and the import marker every in-memory register store carries. */
interface MemoryRegisterState {
  /** Whether the one-time import has run, as the `home_file_import` row would say. */
  imported: boolean;
  /** How many records that import claimed, so a test can see it ran exactly once. */
  importedRecords: number | undefined;
  opened: number;
  closed: number;
}

/** The in-memory press table: rows in insertion order, which is the identity column's order. */
export interface MemoryPressStore extends MemoryRegisterState {
  readonly rows: StoredPress[];
}

/** The in-memory read-cursor table: one row per selection key. */
export interface MemoryReadStore extends MemoryRegisterState {
  readonly rows: Map<string, StoredRead>;
}

/** The in-memory supersession table: one row per artifact id. */
export interface MemorySupersessionStore extends MemoryRegisterState {
  readonly rows: Map<string, StoredSupersession>;
}

/**
 * A fresh, empty marker state.
 *
 * @returns nothing imported, no connection opened
 */
function freshState(): MemoryRegisterState {
  return { closed: 0, imported: false, importedRecords: undefined, opened: 0 };
}

/**
 * A fresh, empty in-memory press store.
 *
 * @returns the store, holding no press and no import marker
 */
export function memoryPressStore(): MemoryPressStore {
  return { ...freshState(), rows: [] };
}

/**
 * A fresh, empty in-memory read-cursor store.
 *
 * @returns the store, holding no cursor and no import marker
 */
export function memoryReadStore(): MemoryReadStore {
  return { ...freshState(), rows: new Map() };
}

/**
 * A fresh, empty in-memory supersession store.
 *
 * @returns the store, holding no retirement and no import marker
 */
export function memorySupersessionStore(): MemorySupersessionStore {
  return { ...freshState(), rows: new Map() };
}

/**
 * The marker half of a connection: the claim inserts its records only when it is the one that wrote the marker,
 * exactly as the transaction in `src/store/registerImport.ts` does.
 *
 * @param state the store's marker
 * @param insertRecords what the import writes into the table
 * @returns the import operations
 */
function memoryImportRows<T>({
  state,
  insertRecords,
  tableHasRows,
}: {
  state: MemoryRegisterState;
  insertRecords: (records: readonly T[]) => void;
  tableHasRows: () => boolean;
}): ImportOnceRows<T> {
  return {
    claim: ({ source }: { source: ImportSource<T> }): Promise<Result<boolean, StoreStepFailure>> => {
      if (state.imported) {
        return Promise.resolve(ok(false));
      }
      const records = source.state === "present" ? source.records : [];
      state.imported = true;
      state.importedRecords = records.length;
      insertRecords(records);
      return Promise.resolve(ok(true));
    },
    marker: () => {
      if (!state.imported) {
        return Promise.resolve(ok(undefined));
      }
      // A test that sets `imported` by hand without a count claims nothing, exactly as an absent file's marker does.
      const { importedRecords = 0 } = state;
      return Promise.resolve(ok({ records: importedRecords, tableHasRows: tableHasRows() }));
    },
  };
}

/**
 * One press as its row stores it.
 *
 * @param record the press
 * @returns its columns
 */
function pressRow({ record }: { record: PressRecord }): StoredPress {
  return { ...record, pressKey: pressKey({ record }) };
}

/**
 * The press table's row operations, with the unique-key semantics the Postgres statements have.
 *
 * @param store the in-memory store
 * @returns the operations
 */
export function memoryPressRows({ store }: { store: MemoryPressStore }): PressJournalRows {
  const byKey = ({ key }: { key: string }): StoredPress | undefined => store.rows.find((row) => row.pressKey === key);
  return {
    ...memoryImportRows<PressRecord>({
      insertRecords: (records) => {
        for (const record of records) {
          const row = pressRow({ record });
          if (byKey({ key: row.pressKey }) === undefined) {
            store.rows.push(row);
          }
        }
      },
      state: store,
      tableHasRows: () => store.rows.length > 0,
    }),
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insert: ({ key, record }) => {
      if (byKey({ key }) !== undefined) {
        return Promise.resolve(ok(undefined));
      }
      const row = pressRow({ record });
      store.rows.push(row);
      return Promise.resolve(ok(row));
    },
    readAll: () => Promise.resolve(ok([...store.rows])),
    readKey: ({ key }) => Promise.resolve(ok(byKey({ key }))),
  };
}

/**
 * One read as its cursor row stores it.
 *
 * @param record the read
 * @param revision the row's revision after this write
 * @returns its columns
 */
function readRow({ record, revision }: { record: ReadRecord; revision: number }): StoredRead {
  return {
    atIso: record.atIso,
    dispatchable: record.dispatchable,
    revision,
    rows: record.rows,
    selection: record.selection,
  };
}

/**
 * The read-cursor table's row operations, with the insert-if-absent and compare-and-set semantics the Postgres
 * statements have.
 *
 * @param store the in-memory store
 * @returns the operations
 */
function memoryReadRows({ store }: { store: MemoryReadStore }): ReadJournalRows {
  return {
    ...memoryImportRows<ReadRecord>({
      insertRecords: (records) => {
        for (const record of records) {
          if (!store.rows.has(record.selection)) {
            store.rows.set(record.selection, readRow({ record, revision: 1 }));
          }
        }
      },
      state: store,
      tableHasRows: () => store.rows.size > 0,
    }),
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insertFirst: ({ record }) => {
      if (store.rows.has(record.selection)) {
        return Promise.resolve(ok(undefined));
      }
      const row = readRow({ record, revision: 1 });
      store.rows.set(record.selection, row);
      return Promise.resolve(ok(row));
    },
    readAll: () => Promise.resolve(ok([...store.rows.values()])),
    readSelection: ({ selection }) => Promise.resolve(ok(store.rows.get(selection))),
    updateAt: ({ record, expected }) => {
      const now = store.rows.get(record.selection);
      const unchanged =
        now !== undefined &&
        now.selection === expected.selection &&
        now.revision === expected.revision &&
        now.atIso === expected.atIso &&
        now.rows === expected.rows &&
        now.dispatchable === expected.dispatchable;
      if (!unchanged) {
        return Promise.resolve(ok(undefined));
      }
      const row = readRow({ record, revision: expected.revision + 1 });
      store.rows.set(record.selection, row);
      return Promise.resolve(ok(row));
    },
  };
}

/**
 * The supersession table's row operations, insert-only under the artifact id, read back in key order as the
 * Postgres `ORDER BY` returns them.
 *
 * @param store the in-memory store
 * @returns the operations
 */
function memorySupersessionRows({ store }: { store: MemorySupersessionStore }): SupersessionRows {
  return {
    ...memoryImportRows({
      insertRecords: (records) => {
        for (const row of foldImportedSupersessions({ records })) {
          if (!store.rows.has(row.artifactId)) {
            store.rows.set(row.artifactId, supersessionColumns({ row }));
          }
        }
      },
      state: store,
      tableHasRows: () => store.rows.size > 0,
    }),
    close: () => {
      store.closed += 1;
      return Promise.resolve();
    },
    insert: ({ row }) => {
      if (store.rows.has(row.artifactId)) {
        return Promise.resolve(ok(undefined));
      }
      const stored = supersessionColumns({ row });
      store.rows.set(row.artifactId, stored);
      return Promise.resolve(ok(stored));
    },
    readAll: () =>
      Promise.resolve(ok([...store.rows.values()].toSorted((a, b) => a.artifactId.localeCompare(b.artifactId)))),
    readArtifact: ({ artifactId }) => Promise.resolve(ok(store.rows.get(artifactId))),
  };
}

/**
 * The store-backed press journal over an in-memory store — the drop-in for `pressJournalPort()` in a unit test.
 *
 * @param store the in-memory store, when a test wants to seed or inspect it; a fresh one otherwise
 * @param readImportFile the old-file read, when a test needs to act inside the import's window
 * @returns the port
 */
export function memoryPressJournalPort({
  store = memoryPressStore(),
  readImportFile = readPressImportFile,
}: { store?: MemoryPressStore; readImportFile?: PressJournalSeams["readImportFile"] } = {}): PressJournalPort {
  return storePressJournalPort({
    seams: {
      connect: () => {
        store.opened += 1;
        return Promise.resolve(ok(memoryPressRows({ store })));
      },
      readImportFile,
    },
  });
}

/**
 * The store-backed read cursor over an in-memory store — the drop-in for `readJournalPort()` in a unit test.
 *
 * @param store the in-memory store, when a test wants to seed or inspect it; a fresh one otherwise
 * @returns the port
 */
export function memoryReadJournalPort({
  store = memoryReadStore(),
}: { store?: MemoryReadStore } = {}): ReadJournalPort {
  return storeReadJournalPort({ seams: memoryReadJournalSeams({ store }) });
}

/**
 * The read cursor's production seams with the database swapped for an in-memory store, for a test that has to
 * interpose on one statement — another writer landing between the read and the compare-and-set, say.
 *
 * @param store the in-memory store the connection addresses
 * @returns the seams
 */
export function memoryReadJournalSeams({ store }: { store: MemoryReadStore }): ReadJournalSeams {
  return {
    connect: () => {
      store.opened += 1;
      return Promise.resolve(ok(memoryReadRows({ store })));
    },
    readImportFile: readReadImportFile,
  };
}

/**
 * The store-backed supersession register over an in-memory store — the drop-in for `supersessionPort()` in a
 * unit test.
 *
 * @param store the in-memory store, when a test wants to seed or inspect it; a fresh one otherwise
 * @returns the port
 */
export function memorySupersessionPort({
  store = memorySupersessionStore(),
}: { store?: MemorySupersessionStore } = {}): SupersessionPort {
  return storeSupersessionPort({
    seams: {
      connect: () => {
        store.opened += 1;
        return Promise.resolve(ok(memorySupersessionRows({ store })));
      },
      readImportFile: readSupersessionImportFile,
    },
  });
}

/** The outage every unavailable port below refuses with: the store's connect failing. */
const OUTAGE = { doing: "be opened", reason: "connect ECONNREFUSED 127.0.0.1:54322 (a fixture outage)" };

/**
 * A press journal whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailablePressJournalPort(): PressJournalPort {
  const outage = PressJournalErrors.storeUnavailable(OUTAGE);
  return { append: () => Promise.resolve(err(outage)), readLatest: () => Promise.resolve(err(outage)) };
}

/**
 * A read cursor whose store cannot be reached — every read and write refuses, exactly as an outage does.
 *
 * @returns the port
 */
export function unavailableReadJournalPort(): ReadJournalPort {
  const outage = ReadJournalErrors.storeUnavailable(OUTAGE);
  return { readLatest: () => Promise.resolve(err(outage)), record: () => Promise.resolve(err(outage)) };
}

/**
 * A supersession register whose store cannot be reached — every read and write refuses, exactly as an outage
 * does.
 *
 * @returns the port
 */
export function unavailableSupersessionPort(): SupersessionPort {
  const outage = SupersessionStoreErrors.storeUnavailable(OUTAGE);
  return { append: () => Promise.resolve(err(outage)), read: () => Promise.resolve(err(outage)) };
}
