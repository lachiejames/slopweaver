/**
 * The Postgres half of the one-time import protocol (`./registerImport.ts`): the `home_file_import` marker
 * operations a register's port runs over one open client. The protocol, its refusals and what it cannot do are
 * that module's header; this one only speaks SQL.
 *
 * Two shapes, one claim. {@link importOnceRowsOver} probes the register's one table for ANY row, which is enough
 * for a register whose import lands in a single table. {@link importOnceRegisterOver} is for a register ONE
 * source document writes into SEVERAL tables, whose rows are versions nothing deletes: its probe COUNTS the rows
 * the import itself wrote across those tables, so a marker claiming more than they hold is refused with both
 * numbers.
 */
import { eq, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import type { StoreClient, StoreReader, StoreWriter } from "./client.js";
import { type ImportMarker, type ImportOnceRows, type MarkedSource, storeStep } from "./registerImport.js";
import { type HomeFileImportRegister, homeFileImportTable } from "./schema/homeFileImport.js";

/**
 * The Postgres marker operations for one register, over an open client.
 *
 * @param client the open store connection
 * @param register which register's marker
 * @param table the register's own table, probed for any row so a marker over an emptied table is caught
 * @param insertRecords the register's own inserts, run inside the transaction only when it won the marker
 * @returns the two operations
 */
export function importOnceRowsOver<T>({
  client,
  register,
  table,
  insertRecords,
}: {
  client: StoreClient;
  register: HomeFileImportRegister;
  table: PgTable;
  insertRecords: (request: { readonly tx: StoreWriter; readonly records: readonly T[] }) => Promise<void>;
}): ImportOnceRows<T> {
  return {
    claim: claimOver({ client, insertRecords, register }),
    marker: () =>
      storeStep({
        doing: `read whether the ${register} register was imported`,
        statement: async (): Promise<ImportMarker | undefined> => {
          const records = await markerRecords({ reader: client, register });
          if (records === undefined) {
            return undefined;
          }
          const anyRow = await client.db
            .select({ one: sql<number>`1` })
            .from(table)
            .limit(1);
          return { records, tableHasRows: anyRow.length > 0 };
        },
      }),
  };
}

/**
 * The marker operations for a register ONE source document writes into SEVERAL tables — the owner's directives
 * and corrections, say. {@link importOnceRowsOver} probes one table for any row, which cannot see the second
 * table at all; this probe COUNTS the rows the import wrote across every table, so the marker is checked against
 * the count rather than against "any row". Only for a register that never deletes an imported row and tags each
 * with its provenance: a count that included rows a later writer added could hide an imported row's loss behind
 * them, so the probe must count the import's own rows and nothing else.
 *
 * @param client the open store connection
 * @param register which register's marker
 * @param probeImportedRows counts the rows the import wrote — by provenance, either state — never a later writer's
 * @param insertRecords the register's own inserts, run inside the transaction only when it won the marker
 * @returns the two operations
 */
export function importOnceRegisterOver<T>({
  client,
  register,
  probeImportedRows,
  insertRecords,
}: {
  client: StoreClient;
  register: HomeFileImportRegister;
  probeImportedRows: (request: { readonly tx: StoreReader }) => Promise<number>;
  insertRecords: (request: { readonly tx: StoreWriter; readonly records: readonly T[] }) => Promise<void>;
}): ImportOnceRows<T> {
  return {
    claim: claimOver({ client, insertRecords, register }),
    marker: () =>
      storeStep({
        doing: `read whether the ${register} register was imported`,
        statement: () => countedImportMarker({ probeImportedRows, reader: client, register }),
      }),
  };
}

/**
 * A counted register's marker and the import's own rows, read through one reader — a store export passes its
 * snapshot transaction, so the count and the rows it exports are the same instant.
 *
 * @param reader the connection or transaction to read through
 * @param register which register's marker
 * @param probeImportedRows counts the rows the import wrote — by provenance, either state — never a later writer's
 * @returns the marker with its observed count, or undefined when no import has run
 */
export async function countedImportMarker({
  reader,
  register,
  probeImportedRows,
}: {
  reader: StoreReader;
  register: HomeFileImportRegister;
  probeImportedRows: (request: { readonly tx: StoreReader }) => Promise<number>;
}): Promise<ImportMarker | undefined> {
  const records = await markerRecords({ reader, register });
  if (records === undefined) {
    return undefined;
  }
  const observedRows = await probeImportedRows({ tx: reader });
  return { observedRows, records, tableHasRows: observedRows > 0 };
}

/**
 * What a register's marker recorded of its file, or undefined when no import has run.
 *
 * @param reader the connection or transaction to read through
 * @param register which register's marker
 * @returns the source the marker recorded, its witness `null` where none was recorded
 */
export async function markedSourceOf({
  reader,
  register,
}: {
  reader: StoreReader;
  register: HomeFileImportRegister;
}): Promise<MarkedSource | undefined> {
  const markers = await reader.db
    .select({
      sourceBytes: homeFileImportTable.sourceBytes,
      sourceSha256: homeFileImportTable.sourceSha256,
      sourceState: homeFileImportTable.sourceState,
    })
    .from(homeFileImportTable)
    .where(eq(homeFileImportTable.register, register))
    .limit(1);
  const marker = markers[0];
  if (marker === undefined) {
    return undefined;
  }
  if (marker.sourceState === "absent") {
    return { state: "absent" };
  }
  if (marker.sourceSha256 === null || marker.sourceBytes === null) {
    return { state: "present", witness: null };
  }
  return { state: "present", witness: { bytes: marker.sourceBytes, sha256: marker.sourceSha256 } };
}

/**
 * The records a register's marker claims, or undefined when it has none.
 *
 * @param reader the connection or transaction to read through
 * @param register which register's marker
 * @returns the claimed count, or undefined
 */
async function markerRecords({
  reader,
  register,
}: {
  reader: StoreReader;
  register: HomeFileImportRegister;
}): Promise<number | undefined> {
  const markers = await reader.db
    .select({ records: homeFileImportTable.records })
    .from(homeFileImportTable)
    .where(eq(homeFileImportTable.register, register))
    .limit(1);
  return markers[0]?.records;
}

/**
 * The claim both marker helpers share: insert the marker `ON CONFLICT DO NOTHING` and, iff this call won it,
 * the source's records — one transaction.
 *
 * @param client the open store connection
 * @param register which register's marker
 * @param insertRecords the register's own inserts
 * @returns the claim operation
 */
function claimOver<T>({
  client,
  register,
  insertRecords,
}: {
  client: StoreClient;
  register: HomeFileImportRegister;
  insertRecords: (request: { readonly tx: StoreWriter; readonly records: readonly T[] }) => Promise<void>;
}): ImportOnceRows<T>["claim"] {
  return ({ source }) =>
    storeStep({
      doing: `import the ${register} register from its home file`,
      statement: () =>
        client.db.transaction(async (tx) => {
          const records = source.state === "present" ? source.records : [];
          const witness = source.state === "present" ? source.witness : undefined;
          const won = await tx
            .insert(homeFileImportTable)
            .values({
              records: records.length,
              register,
              sourceBytes: witness === undefined ? null : witness.bytes,
              sourceSha256: witness === undefined ? null : witness.sha256,
              sourceState: source.state,
            })
            .onConflictDoNothing({ target: homeFileImportTable.register })
            .returning({ register: homeFileImportTable.register });
          if (won.length === 0) {
            return false;
          }
          await insertRecords({ records, tx });
          return true;
        }),
    });
}
