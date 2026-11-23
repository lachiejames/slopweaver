/**
 * The production edges of the press register: the `landing_press` statements, the strict read of the old
 * `landing-presses.jsonl` its one-time import consults, and the factory a composition root calls.
 * `./pressJournalPort.ts` owns every decision; this module only speaks SQL and reads one file.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a stale database — and every failure becomes `PRESS_STORE_UNAVAILABLE`, never an empty answer.
 * Only a composition root calls {@link pressJournalPort}: `SLOPWEAVER_STORE_URL` overrides the home's own
 * selection, so a test that forgot to inject a port could otherwise reach a real store.
 */
import { asc, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient } from "../store/client.js";
import { type ImportSource, readJsonlImportSource, storeStep } from "../store/registerImport.js";
import { importOnceRowsOver } from "../store/registerImportRows.js";
import { landingPressTable } from "../store/schema/landingPress.js";

import { decodePressRecord, type PressRecord, pressKey } from "./pressJournal.js";
import { type PressJournalError, PressJournalErrors, type PressStoreUnavailableError } from "./pressJournalErrors.js";
import {
  type PressJournalPort,
  type PressJournalRows,
  type PressJournalSeams,
  storePressJournalPort,
} from "./pressJournalPort.js";

/** The columns every statement returns, so a read and a write answer in one shape. */
const RETURNED = {
  atIso: landingPressTable.atIso,
  entryState: landingPressTable.entryState,
  headOid: landingPressTable.headOid,
  number: landingPressTable.number,
  pressKey: landingPressTable.pressKey,
  repoSlug: landingPressTable.repoSlug,
};

/**
 * One press as an insert takes it.
 *
 * @param record the press
 * @returns the row values, keyed by its idempotency key
 */
function pressValues({ record }: { record: PressRecord }): typeof landingPressTable.$inferInsert {
  return {
    atIso: record.atIso,
    entryState: record.entryState,
    headOid: record.headOid,
    number: record.number,
    pressKey: pressKey({ record }),
    repoSlug: record.repoSlug,
  };
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
function pressJournalRowsOver({ client }: { client: StoreClient }): PressJournalRows {
  return {
    ...importOnceRowsOver<PressRecord>({
      client,
      insertRecords: async ({ tx, records }) => {
        // One statement per press, in file order, so the identity column keeps the file's order.
        for (const record of records) {
          await tx.insert(landingPressTable).values(pressValues({ record })).onConflictDoNothing();
        }
      },
      register: "landing-presses",
      table: landingPressTable,
    }),
    close: () => client.close(),
    insert: ({ record }) =>
      storeStep({
        doing: "record a press",
        statement: async () => {
          const rows = await client.db
            .insert(landingPressTable)
            .values(pressValues({ record }))
            .onConflictDoNothing({ target: landingPressTable.pressKey })
            .returning(RETURNED);
          return rows[0];
        },
      }),
    readAll: () =>
      storeStep({
        doing: "read the press register",
        statement: () => client.db.select(RETURNED).from(landingPressTable).orderBy(asc(landingPressTable.ordinal)),
      }),
    readKey: ({ key }) =>
      storeStep({
        doing: "read a recorded press",
        statement: async () => {
          const rows = await client.db
            .select(RETURNED)
            .from(landingPressTable)
            .where(eq(landingPressTable.pressKey, key))
            .limit(1);
          return rows[0];
        },
      }),
  };
}

/**
 * Open the store a home selects, as the press register's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, or the store's own refusal
 */
async function connectPressJournalRows({
  home,
}: {
  home: string;
}): Promise<Result<PressJournalRows, PressStoreUnavailableError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    return err(PressJournalErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(pressJournalRowsOver({ client: client.value }));
}

/**
 * The strict read of the old `landing-presses.jsonl`, for its one-time import.
 *
 * @param home the Slopweaver home it lived under
 * @returns its records in file order, `absent`, or the refusal naming the bad line
 */
export function readPressImportFile({ home }: { home: string }): Result<ImportSource<PressRecord>, PressJournalError> {
  return readJsonlImportSource({
    decodeLine: (value) => decodePressRecord({ value }).mapErr((problem) => problem.message),
    path: stateHomePaths({ home }).landingPressesJsonl,
  }).mapErr((problem) => PressJournalErrors.importProblem({ problem }));
}

/**
 * The production seams: the real store and the real old file.
 *
 * @returns the seams {@link pressJournalPort} runs over
 */
export function productionPressJournalSeams(): PressJournalSeams {
  return { connect: connectPressJournalRows, readImportFile: readPressImportFile };
}

/**
 * The port this install's press register is reached through: the store. Composition roots only.
 *
 * @returns the port every production reader and writer uses
 */
export function pressJournalPort(): PressJournalPort {
  return storePressJournalPort({ seams: productionPressJournalSeams() });
}
