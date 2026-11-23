/**
 * The production edges of the landing-read cursor: the `landing_read_cursor` statements, the strict read of
 * the old `landing-reads.json` its one-time import consults, and the factory a composition root calls.
 * `./readJournalPort.ts` owns every decision; this module only speaks SQL and reads one file.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a stale database — and every failure becomes `READ_STORE_UNAVAILABLE`, never an empty answer.
 * Only a composition root calls {@link readJournalPort}: `SLOPWEAVER_STORE_URL` overrides the home's own
 * selection, so a test that forgot to inject a port could otherwise reach a real store.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient } from "../store/client.js";
import { type ImportSource, readJsonImportSource, storeStep } from "../store/registerImport.js";
import { importOnceRowsOver } from "../store/registerImportRows.js";
import { landingReadCursorTable } from "../store/schema/landingReadCursor.js";

import { decodeReadDocument, type ReadRecord } from "./readJournal.js";
import { type ReadJournalError, ReadJournalErrors, type ReadStoreUnavailableError } from "./readJournalErrors.js";
import {
  type ReadJournalPort,
  type ReadJournalRows,
  type ReadJournalSeams,
  type StoredRead,
  storeReadJournalPort,
} from "./readJournalPort.js";

/** The columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = {
  atIso: landingReadCursorTable.atIso,
  dispatchable: landingReadCursorTable.dispatchable,
  revision: landingReadCursorTable.revision,
  rows: landingReadCursorTable.rows,
  selection: landingReadCursorTable.selection,
};

/**
 * One read as an insert takes it, at revision 1.
 *
 * @param record the read
 * @returns the row values
 */
function readValues({ record }: { record: ReadRecord }): typeof landingReadCursorTable.$inferInsert {
  return {
    atIso: record.atIso,
    dispatchable: record.dispatchable,
    revision: 1,
    rows: record.rows,
    selection: record.selection,
  };
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function readJournalRowsOver({ client }: { client: StoreClient }): ReadJournalRows {
  return {
    ...importOnceRowsOver<ReadRecord>({
      client,
      insertRecords: async ({ tx, records }) => {
        if (records.length === 0) {
          return;
        }
        await tx
          .insert(landingReadCursorTable)
          .values(records.map((record) => readValues({ record })))
          .onConflictDoNothing({ target: landingReadCursorTable.selection });
      },
      register: "landing-reads",
      table: landingReadCursorTable,
    }),
    close: () => client.close(),
    insertFirst: ({ record }) =>
      storeStep({
        doing: "record a landing read",
        statement: async () => {
          const rows = await client.db
            .insert(landingReadCursorTable)
            .values(readValues({ record }))
            .onConflictDoNothing({ target: landingReadCursorTable.selection })
            .returning(RETURNED);
          return rows[0];
        },
      }),
    readAll: () =>
      storeStep({
        doing: "read the landing-read cursor",
        statement: () =>
          client.db.select(RETURNED).from(landingReadCursorTable).orderBy(asc(landingReadCursorTable.selection)),
      }),
    readSelection: ({ selection }) =>
      storeStep({
        doing: "read a selection's landing read",
        statement: async () => {
          const rows = await client.db
            .select(RETURNED)
            .from(landingReadCursorTable)
            .where(eq(landingReadCursorTable.selection, selection))
            .limit(1);
          return rows[0];
        },
      }),
    updateAt: ({ record, expected }) =>
      storeStep({ doing: "record a landing read", statement: () => updateCursorAt({ client, expected, record }) }),
  };
}

/**
 * The compare-and-set itself: move one selection's row from `expected` to the next revision, or touch nothing.
 *
 * @param client the open store connection
 * @param record the read to write
 * @param expected the row the writer read and checked, which every column must still match
 * @returns the row as written, or undefined when anything changed it first
 */
async function updateCursorAt({
  client,
  expected,
  record,
}: {
  client: StoreClient;
  expected: StoredRead;
  record: ReadRecord;
}): Promise<StoredRead | undefined> {
  const rows = await client.db
    .update(landingReadCursorTable)
    .set({
      atIso: record.atIso,
      dispatchable: record.dispatchable,
      revision: expected.revision + 1,
      rows: record.rows,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(landingReadCursorTable.selection, record.selection),
        eq(landingReadCursorTable.selection, expected.selection),
        eq(landingReadCursorTable.revision, expected.revision),
        eq(landingReadCursorTable.atIso, expected.atIso),
        eq(landingReadCursorTable.rows, expected.rows),
        eq(landingReadCursorTable.dispatchable, expected.dispatchable),
      ),
    )
    .returning(RETURNED);
  return rows[0];
}

/**
 * Open the store a home selects, as the cursor's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or the store's own refusal
 */
async function connectReadJournalRows({
  home,
}: {
  home: string;
}): Promise<Result<ReadJournalRows, ReadStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(ReadJournalErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(readJournalRowsOver({ client: client.value }));
}

/**
 * The strict read of the old `landing-reads.json`, for its one-time import.
 *
 * @param home the Slopweaver home it lived under
 * @returns one record per selection, `absent`, or the refusal naming the bad entry
 */
export function readReadImportFile({ home }: { home: string }): Result<ImportSource<ReadRecord>, ReadJournalError> {
  return readJsonImportSource({
    decodeDocument: (value) => decodeReadDocument({ value }),
    path: stateHomePaths({ home }).landingReadsJson,
  }).mapErr((problem) => ReadJournalErrors.importProblem({ problem }));
}

/**
 * The production seams: the real store and the real old file.
 *
 * @returns the seams {@link readJournalPort} runs over
 */
export function productionReadJournalSeams(): ReadJournalSeams {
  return { connect: connectReadJournalRows, readImportFile: readReadImportFile };
}

/**
 * The port this install's landing-read cursor is reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function readJournalPort(): ReadJournalPort {
  return storeReadJournalPort({ seams: productionReadJournalSeams() });
}
