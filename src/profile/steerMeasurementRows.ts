/**
 * The production edges of the steer-measurement store — the `steer_measurement` statements, the connection, the
 * home-journal read, and the seams a composition root hands `./steerMeasurementStore.ts`. This module only speaks
 * SQL; every decision is `./steerMeasurementRecords.ts`'s or the orchestration's.
 *
 * ## One appender at a time, by a lock taken before the sequence is read
 *
 * An append runs at `read committed` and its FIRST statement takes a transaction-scoped advisory lock, so two
 * appenders queue rather than both reading the same highest sequence; the read that follows sees everything the
 * previous holder committed. The sequence's unique index stays the database's own guarantee beneath the lock, and an
 * append that meets it anyway is `STEER_APPEND_CONFLICT`.
 *
 * Reads take one `repeatable read`, `read only` snapshot, rows first and the counted marker after.
 */
import { createHash, randomUUID } from "node:crypto";

import { count, eq, max, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";
import { connectStore, type StoreClient, type StoreReader, type StoreWriter } from "../store/client.js";
import { storeStep } from "../store/registerImport.js";
import { countedImportMarker, importOnceRegisterOver, markedSourceOf } from "../store/registerImportRows.js";
import type { HomeFileImportRegister } from "../store/schema/homeFileImport.js";
import { steerMeasurementTable } from "../store/schema/steerMeasurements.js";
import { readWitnessedJournal, type WitnessedJournal } from "../store/witnessedJournal.js";

import type { SteerVerdict } from "./steerKinds.js";
import { type SteerMeasurementError, SteerMeasurementErrors } from "./steerMeasurementErrors.js";
import type {
  SteerAppendOutcome,
  SteerMeasurementRows,
  SteerMeasurementStoreSeams,
  SteerMeasurementTransferSeams,
} from "./steerMeasurementPort.js";
import {
  type ImportedSteerMeasurement,
  importedSteerMeasurementRows,
  nextSteerJournalSeq,
  type StoredSteerMeasurement,
  steerAppendRow,
  steerSnapshotRefusal,
} from "./steerMeasurementRecords.js";

/** The `home_file_import` marker this register's one-time import writes. */
const STEER_MEASUREMENTS_REGISTER: HomeFileImportRegister = "steer-measurements";

/**
 * The advisory-lock key every append takes: the first eight bytes of `sha256("slopweaver:steer-measurements")` read
 * as a signed bigint, so it names this register and nothing else in the database.
 */
export const STEER_MEASUREMENTS_WRITE_LOCK: bigint = createHash("sha256")
  .update("slopweaver:steer-measurements")
  .digest()
  .readBigInt64BE();

/** The read path's transaction: one snapshot, nothing written through it. */
const STEER_READ_SNAPSHOT = { accessMode: "read only", isolationLevel: "repeatable read" } as const;

/**
 * Every import-written line: the count a counted marker is checked against. A `profile` line never counts, so one
 * cannot stand in for an imported line that was lost.
 *
 * @param tx the connection to count through
 * @returns the count
 */
async function countImportedLines({ tx }: { tx: StoreReader }): Promise<number> {
  const [total] = await tx.db
    .select({ rows: count() })
    .from(steerMeasurementTable)
    .where(eq(steerMeasurementTable.origin, "legacy-file"));
  // An aggregate with no GROUP BY always answers exactly one row.
  return total!.rows;
}

/**
 * Every measurement through one reader, the counted marker after it through the same one.
 *
 * @internal — reached from outside this module only through the port's seams; the real-store proof reads it directly.
 * @param reader the reading transaction
 * @returns every measurement in `journal_seq` order, or the marker's refusal
 */
export async function readSteerMeasurementSnapshot({
  reader,
}: {
  reader: StoreReader;
}): Promise<Result<readonly StoredSteerMeasurement[], SteerMeasurementError>> {
  const measurements: readonly StoredSteerMeasurement[] = await reader.db
    .select({
      eventId: steerMeasurementTable.eventId,
      exactLine: steerMeasurementTable.exactLine,
      journalSeq: steerMeasurementTable.journalSeq,
      origin: steerMeasurementTable.origin,
      sourceOrdinal: steerMeasurementTable.sourceOrdinal,
    })
    .from(steerMeasurementTable)
    .orderBy(steerMeasurementTable.journalSeq);
  const refused = steerSnapshotRefusal({
    marker: await countedImportMarker({
      probeImportedRows: countImportedLines,
      reader,
      register: STEER_MEASUREMENTS_REGISTER,
    }),
    measurements,
  });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok(measurements);
}

/**
 * Insert the journal's lines, inside the import's own transaction.
 *
 * @param tx the transaction that won the marker
 * @param records the journal's lines, in order
 */
async function insertImported({
  tx,
  records,
}: {
  tx: StoreWriter;
  records: readonly ImportedSteerMeasurement[];
}): Promise<void> {
  if (records.length > 0) {
    await tx.insert(steerMeasurementTable).values([...importedSteerMeasurementRows({ records })]);
  }
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
 * Whether a thrown failure is a racing appender: a write meeting the sequence's unique index, or a serialization
 * failure (`40001`). Drizzle wraps the driver's error, so the walk follows `cause` a few links down.
 *
 * @param cause what the transaction threw
 * @returns true for a unique violation on the sequence, or a serialization failure
 */
export function isSteerAppendRace({ cause }: { cause: unknown }): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && isRecord(current); depth += 1) {
    if (current["code"] === "23505" && current["constraint_name"] === "uq_steer_measurement_seq") {
      return true;
    }
    if (current["code"] === "40001") {
      return true;
    }
    current = current["cause"];
  }
  return false;
}

/**
 * One append inside its transaction: the lock FIRST, then the highest sequence, then the row.
 *
 * @param tx the writing transaction
 * @param verdict what was judged
 * @returns what was written, or the read-back refusal, which writes nothing
 */
async function appendWithin({
  tx,
  verdict,
}: {
  tx: StoreWriter;
  verdict: SteerVerdict;
}): Promise<Result<SteerAppendOutcome, SteerMeasurementError>> {
  // Spelled as a literal: a constant of this module, never input, and a bigint the driver need not bind.
  await tx.execute(sql`select pg_advisory_xact_lock(${sql.raw(STEER_MEASUREMENTS_WRITE_LOCK.toString())})`);
  const [top] = await tx.select({ highest: max(steerMeasurementTable.journalSeq) }).from(steerMeasurementTable);
  // An aggregate with no GROUP BY always answers exactly one row.
  const row = steerAppendRow({
    journalSeq: nextSteerJournalSeq({ highest: top!.highest }),
    uuid: randomUUID(),
    verdict,
  });
  if (row.isErr()) {
    return err(row.error);
  }
  await tx.insert(steerMeasurementTable).values(row.value);
  return ok({ eventId: row.value.eventId, journalSeq: row.value.journalSeq, kind: "written" });
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
function steerMeasurementRowsOver({ client }: { client: StoreClient }): SteerMeasurementRows {
  return {
    ...importOnceRegisterOver<ImportedSteerMeasurement>({
      client,
      insertRecords: insertImported,
      probeImportedRows: countImportedLines,
      register: STEER_MEASUREMENTS_REGISTER,
    }),
    append: async ({ verdict }) => {
      try {
        return await client.db.transaction(async (tx) => appendWithin({ tx, verdict }));
      } catch (cause) {
        const reason = thrownReason({ cause });
        if (isSteerAppendRace({ cause })) {
          return err(SteerMeasurementErrors.appendConflict({ reason }));
        }
        return err(SteerMeasurementErrors.storeUnavailable({ doing: "append a steer measurement", reason }));
      }
    },
    close: () => client.close(),
    markedSource: () =>
      storeStep({
        doing: "read what the steer-measurement import recorded of its file",
        statement: () => markedSourceOf({ reader: client, register: STEER_MEASUREMENTS_REGISTER }),
      }),
    readStored: async () => {
      try {
        return await client.db.transaction(
          async (tx) => readSteerMeasurementSnapshot({ reader: { db: tx } }),
          STEER_READ_SNAPSHOT,
        );
      } catch (cause) {
        return err(
          SteerMeasurementErrors.storeUnavailable({
            doing: "read the steer measurements",
            reason: thrownReason({ cause }),
          }),
        );
      }
    },
  };
}

/**
 * Open the store a home selects, as the register's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @param env the environment the selection is read from
 * @returns the row operations, `STEER_STORE_UNSELECTED` when the home selects none, or the store's own refusal
 */
async function connectSteerMeasurementRows({
  home,
  env,
}: {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}): Promise<Result<SteerMeasurementRows, SteerMeasurementError>> {
  const client = await connectStore({ env, home });
  if (client.isErr()) {
    if (client.error.code === "STORE_URL_MISSING") {
      return err(SteerMeasurementErrors.storeUnselected({ needed: "need a store", selection: client.error.message }));
    }
    return err(SteerMeasurementErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(steerMeasurementRowsOver({ client: client.value }));
}

/**
 * The strict read of the home journal under a home.
 *
 * @param home the Slopweaver home it lived under
 * @returns what the path holds, or why it would not read
 */
export function readHomeFileSteerMeasurements({
  home,
}: {
  home: string;
}): Result<WitnessedJournal, SteerMeasurementError> {
  return readWitnessedJournal({ path: stateHomePaths({ home }).judgement.steerKindsJsonl }).mapErr((problem) =>
    SteerMeasurementErrors.homeFileUnreadable(problem),
  );
}

/**
 * The production seams: the real store and the real home journal.
 *
 * @param env the environment the store selection is read from; defaults to the process's own
 * @returns the seams the port runs over
 */
export function productionSteerMeasurementSeams({
  env = process.env,
}: {
  env?: Readonly<Record<string, string | undefined>>;
} = {}): SteerMeasurementStoreSeams {
  return {
    connect: ({ home }) => connectSteerMeasurementRows({ env, home }),
    readHomeFile: readHomeFileSteerMeasurements,
  };
}

/**
 * The production seams a store export's transfer port runs over: the real table through the export's own
 * connection, and the real home journal.
 *
 * @returns the seams
 */
export function productionSteerMeasurementTransferSeams(): SteerMeasurementTransferSeams {
  return {
    readHomeFile: readHomeFileSteerMeasurements,
    readSnapshot: readSteerMeasurementSnapshot,
    rowsOver: steerMeasurementRowsOver,
  };
}
