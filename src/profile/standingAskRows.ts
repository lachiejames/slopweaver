/**
 * The production edges of the standing-ask store — the `standing_ask*` statements, the connection, and the seams a
 * composition root hands `./standingAskStore.ts`. This module only speaks SQL; every decision is
 * `./standingAskRecords.ts`'s, `./standingAskWrites.ts`'s or the orchestration's.
 *
 * ## One writer at a time, by a lock taken before anything is read
 *
 * A write runs at `read committed` and its FIRST statement takes a transaction-scoped advisory lock, so two writers
 * queue rather than both deciding against the same register; the read that follows sees everything the previous
 * holder committed. `repeatable read` would be wrong here: its snapshot is fixed at the first statement, which is
 * the lock wait itself, so a writer would decide against the register as it stood before the holder it waited on.
 * The unique indexes stay the database's own guarantee beneath the lock — one active generation per id, one active
 * ask per card, one event per sequence — and a write that meets one anyway is `STANDING_ASK_WRITE_CONFLICT`.
 *
 * Reads take one `repeatable read`, `read only` snapshot, rows first and the counted marker after.
 *
 * Every connection comes from `connectStore`; a missing selection is `STANDING_ASK_STORE_UNSELECTED`, everything
 * else `STANDING_ASK_STORE_UNAVAILABLE`, never an empty answer.
 */
import { randomUUID } from "node:crypto";

import { and, count, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient, type StoreReader, type StoreWriter } from "../store/client.js";
import { storeStep } from "../store/registerImport.js";
import { countedImportMarker, importOnceRegisterOver, markedSourceOf } from "../store/registerImportRows.js";
import type { HomeFileImportRegister } from "../store/schema/homeFileImport.js";
import { standingAskCoverageTable, standingAskEventTable, standingAskTable } from "../store/schema/standingAsks.js";

import { type StandingAskError, StandingAskErrors } from "./standingAskErrors.js";
import { readHomeFileStandingAsks } from "./standingAskImport.js";
import type { StandingAskRows, StandingAskStoreSeams, StandingAskTransferSeams } from "./standingAskPort.js";
import {
  type ImportedStandingAskEvent,
  importedStandingAskRows,
  type StandingAskInsertRows,
  type StoredStandingAskEvent,
  type StoredStandingAsks,
} from "./standingAskRecords.js";
import { isStandingAskWriteRace, lockedStandingAskWrite, standingAskSnapshotOver } from "./standingAskWrites.js";

/** The `home_file_import` marker this register's one-time import writes. */
const STANDING_ASKS_REGISTER: HomeFileImportRegister = "standing-asks";

/**
 * The advisory-lock key every standing-ask write takes: one fixed bigint, so it names this register and nothing
 * else in the database. Its digits are the first eight bytes of `sha256("slopweaver:standing-asks")` read as a
 * signed integer, reproduced by
 * `node -e 'console.log(require("crypto").createHash("sha256").update("slopweaver:standing-asks").digest().readBigInt64BE())'`.
 */
export const STANDING_ASKS_WRITE_LOCK = 8_366_724_702_866_285_013n;

/** The read path's transaction: one snapshot, nothing written through it. */
const STANDING_ASKS_READ_SNAPSHOT = { accessMode: "read only", isolationLevel: "repeatable read" } as const;

/**
 * Every import-written event: the count a counted marker is checked against. A `profile` event never counts, so one
 * cannot stand in for an imported event that was lost.
 *
 * @param tx the connection to count through
 * @returns the count
 */
async function countHomeFileEvents({ tx }: { tx: StoreReader }): Promise<number> {
  const [total] = await tx.db
    .select({ rows: count() })
    .from(standingAskEventTable)
    .where(eq(standingAskEventTable.origin, "legacy-file"));
  // An aggregate with no GROUP BY always answers exactly one row.
  return total!.rows;
}

/**
 * Every event, generation and coverage row — withdrawn ones too, so a read checks the whole projection — through one
 * reader. The fold reads all history on every operation, and stays a full fold until a measurement shows the
 * register is large: nothing here has measured it, so no snapshot or compaction is built against a guess.
 *
 * @param reader the reading transaction
 * @returns the register's rows
 */
async function readRows({ reader }: { reader: StoreReader }): Promise<StoredStandingAsks> {
  const events: StoredStandingAskEvent[] = await reader.db
    .select({
      askRowId: standingAskEventTable.askRowId,
      exactLine: standingAskEventTable.exactLine,
      journalSeq: standingAskEventTable.journalSeq,
      kind: standingAskEventTable.kind,
      origin: standingAskEventTable.origin,
    })
    .from(standingAskEventTable)
    .orderBy(standingAskEventTable.journalSeq);
  const asks = await reader.db
    .select({
      askId: standingAskTable.askId,
      origin: standingAskTable.origin,
      quoteAnchor: standingAskTable.quoteAnchor,
      quoteAt: standingAskTable.quoteAt,
      quoteCut: standingAskTable.quoteCut,
      quoteWhere: standingAskTable.quoteWhere,
      quoteWords: standingAskTable.quoteWords,
      recordedAt: standingAskTable.recordedAt,
      recordedSeq: standingAskTable.recordedSeq,
      rowId: standingAskTable.rowId,
      state: standingAskTable.state,
    })
    .from(standingAskTable)
    .orderBy(standingAskTable.recordedSeq);
  const coverage = await reader.db
    .select({
      askRowId: standingAskCoverageTable.askRowId,
      coverage: standingAskCoverageTable.coverage,
      ordinal: standingAskCoverageTable.ordinal,
      state: standingAskCoverageTable.state,
    })
    .from(standingAskCoverageTable)
    .orderBy(standingAskCoverageTable.askRowId, standingAskCoverageTable.ordinal);
  return { asks, coverage, events };
}

/**
 * The register with its import marker re-counted through the SAME reader — what every reader takes: a
 * `profile standing` read or write, and a store export inside its own snapshot (the transfer seams below).
 *
 * @internal — reached from outside this module only through the port's seams; the real-store proof reads it directly.
 * @param reader the reading transaction
 * @returns the register, or the marker's refusal
 */
export async function readStandingAskSnapshot({
  reader,
}: {
  reader: StoreReader;
}): Promise<Result<StoredStandingAsks, StandingAskError>> {
  return standingAskSnapshotOver({
    readMarker: () =>
      countedImportMarker({ probeImportedRows: countHomeFileEvents, reader, register: STANDING_ASKS_REGISTER }),
    readRows: () => readRows({ reader }),
  });
}

/**
 * Insert rows in the order their keys need: generations, then their coverage, then the events naming them.
 *
 * @param tx the writing transaction
 * @param rows what to insert
 */
async function insertRows({ tx, rows }: { tx: StoreWriter; rows: StandingAskInsertRows }): Promise<void> {
  if (rows.asks.length > 0) {
    await tx.insert(standingAskTable).values([...rows.asks]);
  }
  if (rows.coverage.length > 0) {
    await tx.insert(standingAskCoverageTable).values([...rows.coverage]);
  }
  if (rows.events.length > 0) {
    await tx.insert(standingAskEventTable).values([...rows.events]);
  }
}

/**
 * Insert the journal's events, inside the import's own transaction.
 *
 * @param tx the transaction that won the marker
 * @param records the journal's events, in order
 */
async function insertImported({
  tx,
  records,
}: {
  tx: StoreWriter;
  records: readonly ImportedStandingAskEvent[];
}): Promise<void> {
  await insertRows({ rows: importedStandingAskRows({ events: records, mintId: randomUUID }), tx });
}

/**
 * The message of whatever a transaction threw.
 *
 * @param cause what was thrown
 * @returns its message, or a fixed sentence for a non-Error throw
 */
function thrownReason({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
function standingAskRowsOver({ client }: { client: StoreClient }): StandingAskRows {
  return {
    ...importOnceRegisterOver<ImportedStandingAskEvent>({
      client,
      insertRecords: insertImported,
      probeImportedRows: countHomeFileEvents,
      register: STANDING_ASKS_REGISTER,
    }),
    close: () => client.close(),
    markedSource: () =>
      storeStep({
        doing: "read what the standing-ask import recorded of its file",
        statement: () => markedSourceOf({ reader: client, register: STANDING_ASKS_REGISTER }),
      }),
    readStored: async () => {
      try {
        return await client.db.transaction(
          async (tx) => readStandingAskSnapshot({ reader: { db: tx } }),
          STANDING_ASKS_READ_SNAPSHOT,
        );
      } catch (cause) {
        return err(
          StandingAskErrors.storeUnavailable({ doing: "read the standing asks", reason: thrownReason({ cause }) }),
        );
      }
    },
    write: async ({ decide }) => {
      try {
        return await client.db.transaction(async (tx) =>
          lockedStandingAskWrite({
            apply: async ({ rows }) => {
              if (rows.withdrawRowId !== undefined) {
                await tx
                  .update(standingAskTable)
                  .set({ state: "withdrawn" })
                  .where(and(eq(standingAskTable.rowId, rows.withdrawRowId), eq(standingAskTable.state, "active")));
              }
              await insertRows({ rows, tx });
            },
            decide,
            lock: async () => {
              // Spelled as a literal: a constant of this module, never input, and a bigint the driver need not bind.
              await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(STANDING_ASKS_WRITE_LOCK.toString())})`);
            },
            mintId: randomUUID,
            read: () => readStandingAskSnapshot({ reader: { db: tx } }),
          }),
        );
      } catch (cause) {
        const reason = thrownReason({ cause });
        if (isStandingAskWriteRace({ cause })) {
          return err(StandingAskErrors.writeConflict({ reason }));
        }
        return err(StandingAskErrors.storeUnavailable({ doing: "record a standing-ask write", reason }));
      }
    },
  };
}

/**
 * Open the store a home selects, as the register's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, `STORE_UNSELECTED` when the home selects none, or the store's own refusal
 */
async function connectStandingAskRows({ home }: { home: string }): Promise<Result<StandingAskRows, StandingAskError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    if (client.error.code === "STORE_URL_MISSING") {
      return err(StandingAskErrors.storeUnselected({ needed: "need a store", selection: client.error.message }));
    }
    return err(StandingAskErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(standingAskRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store and the real home journal.
 *
 * @returns the seams the port runs over
 */
export function productionStandingAskSeams(): StandingAskStoreSeams {
  return { connect: connectStandingAskRows, readHomeFile: readHomeFileStandingAsks };
}

/**
 * The production seams a store export's transfer port runs over: the real tables through the export's own
 * connection, and the real home journal.
 *
 * @returns the seams
 */
export function productionStandingAskTransferSeams(): StandingAskTransferSeams {
  return {
    readHomeFile: readHomeFileStandingAsks,
    readSnapshot: readStandingAskSnapshot,
    rowsOver: standingAskRowsOver,
  };
}
