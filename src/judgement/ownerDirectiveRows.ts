/**
 * The production edges of the owner-judgement store — the `owner_directive` and `owner_correction` statements,
 * the connection, and the seams a composition root hands `./ownerDirectiveStore.ts`. This module only speaks
 * SQL; every decision is `./ownerJudgementRecords.ts`'s or the orchestration's.
 *
 * ## Versions, inside one transaction
 *
 * A memory event reads the active versions, plans against them and applies the plan in ONE transaction:
 * retiring an id sets its active version `inactive`, activating inserts a new `active` version. Two writers that
 * race on the same id meet the partial unique index on the active version, and the loser is
 * `OWNER_DIRECTIVE_WRITE_CONFLICT` with nothing written, never a second active version. Retiring only ever
 * changes `state`: an imported version keeps `origin = 'legacy-file'` after a memory event retires it, and the
 * version that replaces it is `memory`.
 *
 * Every connection comes from `connectStore` — the checked entrance that refuses a missing selection, a remote
 * host and a stale database. A missing selection is `OWNER_DIRECTIVE_STORE_UNSELECTED`, so the orchestration can
 * tell a home that never selected a store apart from one whose store is down; everything else is
 * `OWNER_DIRECTIVE_STORE_UNAVAILABLE`, never an empty answer.
 */
import { and, count, eq, inArray, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { connectStore, type StoreClient, type StoreReader, type StoreWriter } from "../store/client.js";
import { countedImportMarker, importOnceRegisterOver } from "../store/registerImportRows.js";
import type { HomeFileImportRegister } from "../store/schema/homeFileImport.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../store/schema/ownerJudgement.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";
import { readHomeFileOwnerJudgement } from "./ownerDirectiveImport.js";
import type { OwnerDirectiveStoreSeams, OwnerJudgementRows } from "./ownerDirectivePort.js";
import {
  correctionRowOf,
  directiveRowOf,
  importedRowsOf,
  type OwnerJudgementRecord,
  type OwnerJudgementTransition,
  type StoredOwnerJudgement,
} from "./ownerJudgementRecords.js";
import { guardedRead, guardedWrite, planThenApply, snapshotOver } from "./ownerJudgementTransactions.js";

/** The `home_file_import` marker this register's one-time import writes. */
const OWNER_JUDGEMENT_REGISTER: HomeFileImportRegister = "owner-judgement";

/**
 * The memory-plan transaction: ONE snapshot for the plan's whole read. Under `read committed` the directive and
 * correction reads could each see a different moment, and the plan would run against an authority that never
 * existed. A writer that loses to a concurrent change is `40001`, read as a write conflict.
 */
export const OWNER_JUDGEMENT_WRITE_SNAPSHOT = { isolationLevel: "repeatable read" } as const;

/** The read path's transaction: the same one snapshot, and nothing written through it. */
const OWNER_JUDGEMENT_READ_SNAPSHOT = { ...OWNER_JUDGEMENT_WRITE_SNAPSHOT, accessMode: "read only" } as const;

/** The directive columns every read returns. */
const DIRECTIVE_COLUMNS = {
  directiveId: ownerDirectiveTable.directiveId,
  origin: ownerDirectiveTable.origin,
  rowId: ownerDirectiveTable.rowId,
  sourceContentHash: ownerDirectiveTable.sourceContentHash,
  sourceFile: ownerDirectiveTable.sourceFile,
  sourceModified: ownerDirectiveTable.sourceModified,
  state: ownerDirectiveTable.state,
  text: ownerDirectiveTable.text,
};

/** The correction columns every read returns. */
const CORRECTION_COLUMNS = {
  correctionId: ownerCorrectionTable.correctionId,
  origin: ownerCorrectionTable.origin,
  rowId: ownerCorrectionTable.rowId,
  sourceContentHash: ownerCorrectionTable.sourceContentHash,
  sourceFile: ownerCorrectionTable.sourceFile,
  sourceModified: ownerCorrectionTable.sourceModified,
  state: ownerCorrectionTable.state,
  subjectContainer: ownerCorrectionTable.subjectContainer,
  subjectSource: ownerCorrectionTable.subjectSource,
  subjectSourceId: ownerCorrectionTable.subjectSourceId,
  subjectUrl: ownerCorrectionTable.subjectUrl,
  text: ownerCorrectionTable.text,
};

/**
 * Every ACTIVE version in both tables, through one reader — only ever called by
 * {@link readOwnerJudgementSnapshot}, which re-counts the marker beside it.
 *
 * @param reader the reading transaction
 * @returns both tables' active versions, ordered by logical id
 */
async function readActiveOwnerJudgement({ reader }: { reader: StoreReader }): Promise<StoredOwnerJudgement> {
  const directives = await reader.db
    .select(DIRECTIVE_COLUMNS)
    .from(ownerDirectiveTable)
    .where(eq(ownerDirectiveTable.state, "active"))
    .orderBy(ownerDirectiveTable.directiveId);
  const corrections = await reader.db
    .select(CORRECTION_COLUMNS)
    .from(ownerCorrectionTable)
    .where(eq(ownerCorrectionTable.state, "active"))
    .orderBy(ownerCorrectionTable.correctionId);
  return { corrections, directives };
}

/**
 * Every row the one-time import wrote — `origin = 'legacy-file'`, in either state, across both tables — the count
 * a counted import marker is checked against. A memory-written version is never counted, so one cannot stand in
 * for an imported row that was lost; a retired legacy version is, because retiring never changes its origin.
 *
 * @param tx the connection to count through
 * @returns the total
 */
async function countHomeFileRows({ tx }: { tx: StoreReader }): Promise<number> {
  // ONE statement over both tables: two counts would each take their own snapshot under `read committed`, so a
  // row deleted between them could be missed by both and the sum would still match the marker.
  const corrections = tx.db
    .select({ rows: count() })
    .from(ownerCorrectionTable)
    .where(eq(ownerCorrectionTable.origin, "legacy-file"));
  const [total] = await tx.db
    .select({ rows: sql<number>`${count()} + (${corrections})`.mapWith(Number) })
    .from(ownerDirectiveTable)
    .where(eq(ownerDirectiveTable.origin, "legacy-file"));
  // An aggregate with no GROUP BY always answers exactly one row.
  return total!.rows;
}

/**
 * The active versions, with the import marker re-checked through the SAME reader — what every reader takes: a
 * turn or reflect brief, a memory event's plan and a store export. Each runs the one-time import before this read,
 * so a legacy row deleted between the two would otherwise read as a smaller register; counting inside the reading
 * transaction makes the check and the rows one instant. The rows are read first and counted second, in ONE
 * statement, so even under `read committed` a deletion the rows saw is one the count sees too.
 *
 * What it closes: a lost imported row (fewer), a second import behind a deleted marker that left the old rows
 * (more), and a marker gone at read time (refused). What it does not: a marker deleted TOGETHER with every row it
 * counted leaves a store indistinguishable from one never imported, so a re-import of an equal-sized file read
 * after it passes as that store's authority — consistent, but not the first file's. Only a durable import
 * witness that outlives the marker (an append-only import history no delete reaches) would tell the two apart.
 *
 * @param reader the reading transaction
 * @returns both tables' active versions, or the marker's refusal
 */
export async function readOwnerJudgementSnapshot({
  reader,
}: {
  reader: StoreReader;
}): Promise<Result<StoredOwnerJudgement, OwnerDirectiveError>> {
  return snapshotOver({
    readActive: () => readActiveOwnerJudgement({ reader }),
    readMarker: () =>
      countedImportMarker({ probeImportedRows: countHomeFileRows, reader, register: OWNER_JUDGEMENT_REGISTER }),
  });
}

/**
 * Insert the legacy file's instructions as active versions, inside the import's own transaction.
 *
 * @param tx the transaction that won the marker
 * @param records the file's directives and corrections
 */
async function insertImported({
  tx,
  records,
}: {
  tx: StoreWriter;
  records: readonly OwnerJudgementRecord[];
}): Promise<void> {
  const { directives, corrections } = importedRowsOf({ records });
  if (directives.length > 0) {
    await tx.insert(ownerDirectiveTable).values([...directives]);
  }
  if (corrections.length > 0) {
    await tx.insert(ownerCorrectionTable).values([...corrections]);
  }
}

/**
 * Apply one planned transition inside the writing transaction: retire first, so a changed id's new version is
 * the only active one when the insert meets the partial unique index.
 *
 * @param tx the writing transaction
 * @param transition what the plan decided
 */
async function applyTransition({
  tx,
  transition,
}: {
  tx: StoreWriter;
  transition: OwnerJudgementTransition;
}): Promise<void> {
  if (transition.retireDirectives.length > 0) {
    await tx
      .update(ownerDirectiveTable)
      .set({ state: "inactive" })
      .where(
        and(
          eq(ownerDirectiveTable.state, "active"),
          inArray(ownerDirectiveTable.directiveId, [...transition.retireDirectives]),
        ),
      );
  }
  if (transition.retireCorrections.length > 0) {
    await tx
      .update(ownerCorrectionTable)
      .set({ state: "inactive" })
      .where(
        and(
          eq(ownerCorrectionTable.state, "active"),
          inArray(ownerCorrectionTable.correctionId, [...transition.retireCorrections]),
        ),
      );
  }
  if (transition.activateDirectives.length > 0) {
    await tx
      .insert(ownerDirectiveTable)
      .values(
        transition.activateDirectives.map((directive) =>
          directiveRowOf({ directive, origin: "memory", state: "active" }),
        ),
      );
  }
  if (transition.activateCorrections.length > 0) {
    await tx
      .insert(ownerCorrectionTable)
      .values(
        transition.activateCorrections.map((correction) =>
          correctionRowOf({ correction, origin: "memory", state: "active" }),
        ),
      );
  }
}

/**
 * The row operations over one open client.
 *
 * @param client the open store connection
 * @returns the operations, and the close the caller owns
 */
export function ownerJudgementRowsOver({ client }: { client: StoreClient }): OwnerJudgementRows {
  return {
    ...importOnceRegisterOver<OwnerJudgementRecord>({
      client,
      insertRecords: insertImported,
      probeImportedRows: countHomeFileRows,
      register: OWNER_JUDGEMENT_REGISTER,
    }),
    close: () => client.close(),
    readStored: () =>
      guardedRead({
        run: () =>
          client.db.transaction(
            async (tx) => readOwnerJudgementSnapshot({ reader: { db: tx } }),
            OWNER_JUDGEMENT_READ_SNAPSHOT,
          ),
      }),
    transact: ({ plan }) =>
      guardedWrite({
        run: () =>
          client.db.transaction(
            async (tx) =>
              planThenApply({
                apply: ({ transition }) => applyTransition({ transition, tx }),
                plan,
                read: () => readOwnerJudgementSnapshot({ reader: { db: tx } }),
              }),
            OWNER_JUDGEMENT_WRITE_SNAPSHOT,
          ),
      }),
  };
}

/**
 * Open the store a home selects, as the register's row operations.
 *
 * @param home the Slopweaver home whose store selection is read
 * @returns the row operations, `STORE_UNSELECTED` when the home selects none, or the store's own refusal
 */
async function connectOwnerJudgementRows({
  home,
}: {
  home: string;
}): Promise<Result<OwnerJudgementRows, OwnerDirectiveError>> {
  const client = await connectStore({ home });
  if (client.isErr()) {
    if (client.error.code === "STORE_URL_MISSING") {
      return err(OwnerDirectiveErrors.storeUnselected({ needed: "need a store", selection: client.error.message }));
    }
    return err(OwnerDirectiveErrors.storeUnavailable({ doing: "be opened", reason: client.error.message }));
  }
  return ok(ownerJudgementRowsOver({ client: client.value }));
}

/**
 * The production seams: the real store and the real legacy file.
 *
 * @returns the seams the port runs over
 */
export function productionOwnerDirectiveSeams(): OwnerDirectiveStoreSeams {
  return { connect: connectOwnerJudgementRows, readHomeFile: readHomeFileOwnerJudgement };
}
