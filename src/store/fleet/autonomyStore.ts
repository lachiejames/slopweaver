/**
 * The autonomy register's half of the store: its one-time import, the read-back that import compares, and the
 * singleton marker that says the store, not the home's file, answers for the ledger from then on.
 *
 * Split out of `./store.ts`, whose header carries the re-runnability story every ledger here shares: an
 * untargeted `DO NOTHING` on the line's import key, a read-back the leg compares line by line, and never a delete
 * or an overwrite. Like that file, every function takes an already-open {@link StoreClient}.
 */
import { asc, eq, isNotNull } from "drizzle-orm";

import { boundAutonomyEventRow } from "../../autonomy/storeRecord.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import {
  AUTONOMY_REGISTER_ID,
  autonomyEventTable,
  autonomyRegisterTable,
  type NewAutonomyEventRecord,
} from "../schema/ledgers.js";

import type { StoredAutonomyImportRow } from "./autonomyEvent.js";
import { batched } from "./store.js";

/**
 * Write autonomy register lines, keyed on the import key of the physical line each came from.
 *
 * Every batch rides ONE transaction: the port treats a store with no import marker and no register file as a
 * fresh ledger, so a failure part-way through a register must leave none of it behind for a reader to mistake
 * for the whole once the file is gone.
 *
 * @param client an open store connection
 * @param rows every projected line, in source order
 * @returns how many rows were NEWLY written
 */
export async function importAutonomyEvents({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly NewAutonomyEventRecord[];
}): Promise<Result<number, StoreError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    const written = await client.db.transaction(async (writer: StoreWriter): Promise<number> => {
      let count = 0;
      for (const batch of batched({ rows })) {
        const inserted = await writer
          .insert(autonomyEventTable)
          .values(batch.map((row) => boundAutonomyEventRow({ row })))
          .onConflictDoNothing()
          .returning({ id: autonomyEventTable.id });
        count += inserted.length;
      }
      return count;
    });
    return ok(written);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `import ${String(rows.length)} autonomy event(s)` }));
  }
}

/**
 * Every AUTHORITY autonomy row (a non-null `record`), in `seq` order — what the import's read-back compares.
 *
 * @param client an open store connection
 * @returns each row's key, entry kind, act id and record, or the typed database failure
 */
export async function readStoredAutonomyRows({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly StoredAutonomyImportRow[], StoreError>> {
  try {
    const rows = await client.db
      .select({
        actionId: autonomyEventTable.actionId,
        entryKind: autonomyEventTable.entryKind,
        importKey: autonomyEventTable.importKey,
        record: autonomyEventTable.record,
      })
      .from(autonomyEventTable)
      .where(isNotNull(autonomyEventTable.record))
      .orderBy(asc(autonomyEventTable.seq));
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read the autonomy rows back" }));
  }
}

/**
 * Whether the one-time import of the home's autonomy register has completed.
 *
 * @param client an open store connection
 * @returns whether the singleton `autonomy_register` row exists
 */
export async function readAutonomyImported({ client }: { client: StoreClient }): Promise<Result<boolean, StoreError>> {
  try {
    const rows = await client.db
      .select({ id: autonomyRegisterTable.id })
      .from(autonomyRegisterTable)
      .where(eq(autonomyRegisterTable.id, AUTONOMY_REGISTER_ID));
    return ok(rows.length > 0);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read whether the autonomy register was imported" }));
  }
}

/**
 * Record that the one-time import completed. Written LAST, and only after a clean read-back: from this row on,
 * the store answers for the ledger, and the home's file is opened only by a verify-only rerun of the import.
 *
 * @param client an open store connection
 * @returns nothing on success, or the typed database failure
 */
export async function markAutonomyImported({ client }: { client: StoreClient }): Promise<Result<void, StoreError>> {
  try {
    await client.db.insert(autonomyRegisterTable).values({ id: AUTONOMY_REGISTER_ID }).onConflictDoNothing();
    return ok(undefined);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "mark the autonomy register imported" }));
  }
}
