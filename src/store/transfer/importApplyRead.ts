/**
 * What an apply reads inside its one transaction, before it writes anything: the batch row locked `FOR UPDATE`, every
 * staging table it reads held against writes and trigger changes, both journals' write locks and every live register
 * locked against writers in one fixed order, and only then the batch read back and its export planned again over the
 * live store as this transaction sees it — so what is compared is exactly what is written over, and the answers read
 * are the ones the guards held. The writes are `./importApply.ts`, the read back after them `./importApplyReadBack.ts`.
 */
import { eq, getTableName, sql } from "drizzle-orm";

import { err, type Result } from "#lib/result.js";

import { STANDING_ASKS_WRITE_LOCK } from "../../profile/standingAskRows.js";
import { STEER_MEASUREMENTS_WRITE_LOCK } from "../../profile/steerMeasurementRows.js";
import type { StoreWriter } from "../client.js";
import {
  storeImportApplicationTable,
  storeImportBatchTable,
  storeImportItemTable,
  storeImportPartTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
} from "../schema/importStaging.js";
import { memoriesTable } from "../schema/memories.js";
import { memoryRecallsTable } from "../schema/memoryRecalls.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../schema/ownerJudgement.js";
import { ownerProfileTable } from "../schema/ownerProfile.js";
import { ownerVoiceRegisterTable } from "../schema/ownerVoice.js";
import { standingAskCoverageTable, standingAskEventTable, standingAskTable } from "../schema/standingAsks.js";
import { steerMeasurementTable } from "../schema/steerMeasurements.js";

import { readStoreContentsIn } from "./bundleWrite.js";
import { planImport } from "./compare.js";
import { type ImportEffects, importApplicationEffects } from "./importApplyEffects.js";
import { type StoreImportApplyError, StoreImportApplyErrors } from "./importApplyErrors.js";
import { applicationReadiness, type ImportApplicationPlan, reconstructStagedImport } from "./importApplyPlan.js";
import { liveRetained } from "./liveRetained.js";
import { importRowStatuses } from "./rowClassify.js";
import { stagedPartNames, stagedQuestions } from "./stagedBatchRead.js";

/** The live registers an apply locks against writers, in the one order every apply takes them. */
const LOCKED_REGISTERS = [
  ownerProfileTable,
  ownerVoiceRegisterTable,
  memoriesTable,
  memoryRecallsTable,
  ownerDirectiveTable,
  ownerCorrectionTable,
  standingAskTable,
  standingAskCoverageTable,
  standingAskEventTable,
  steerMeasurementTable,
] as const;

/** A staged batch's own row. */
export interface LockedBatch {
  /** `null` for a batch staged before batches recorded their comparison version, which reads back stale. */
  readonly comparisonVersion: number | null;
  readonly contentDigest: string;
  readonly id: string;
  readonly planDigest: string;
}

/**
 * The batch row, held `FOR UPDATE` until the transaction ends, so two applies of one batch serialise and the second
 * finds the first's receipt.
 *
 * @returns the batch, or `undefined` when none is staged under the id
 */
export async function lockedBatch({
  writer,
  batchId,
}: {
  writer: StoreWriter;
  batchId: string;
}): Promise<LockedBatch | undefined> {
  const [batch] = await writer
    .select({
      comparisonVersion: storeImportBatchTable.comparisonVersion,
      contentDigest: storeImportBatchTable.contentDigest,
      id: storeImportBatchTable.id,
      planDigest: storeImportBatchTable.planDigest,
    })
    .from(storeImportBatchTable)
    .where(eq(storeImportBatchTable.id, batchId))
    .for("update");
  return batch;
}

/**
 * The staging tables an apply reads, in the order staging writes them. Held in SHARE mode: no row of any can be
 * written, and no trigger on any disabled — `alter table … disable trigger` needs share row exclusive, which SHARE
 * refuses — until the apply's transaction ends.
 */
const READ_STAGING = [
  storeImportBatchTable,
  storeImportPartTable,
  storeImportItemTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
] as const;

/**
 * Hold every staging table the apply reads in SHARE mode, then the receipt table in share row exclusive, so the guards
 * checked after this and every answer read stay as they were until the apply commits. Taken AFTER the batch row's
 * `FOR UPDATE`: answering takes that row `FOR SHARE` before it writes a resolution, so the other order could deadlock.
 *
 * @param writer the apply's open transaction, which holds every lock until it ends
 */
export async function lockStaging({ writer }: { writer: StoreWriter }): Promise<void> {
  for (const table of READ_STAGING) {
    await writer.execute(
      sql`lock table ${sql.identifier("public")}.${sql.identifier(getTableName(table))} in share mode`,
    );
  }
  await writer.execute(
    sql`lock table ${sql.identifier("public")}.${sql.identifier(getTableName(storeImportApplicationTable))} in share row exclusive mode`,
  );
}

/**
 * Hold both journals' write locks, in the order their own writers take them, then every live register against
 * writers — and so against a trigger on one being disabled — in its one fixed order.
 *
 * @param writer the apply's open transaction, which holds every lock until it ends
 */
export async function lockRegisters({ writer }: { writer: StoreWriter }): Promise<void> {
  await writer.execute(sql`select pg_advisory_xact_lock(${sql.raw(STANDING_ASKS_WRITE_LOCK.toString())})`);
  await writer.execute(sql`select pg_advisory_xact_lock(${sql.raw(STEER_MEASUREMENTS_WRITE_LOCK.toString())})`);
  for (const table of LOCKED_REGISTERS) {
    await writer.execute(
      sql`lock table ${sql.identifier("public")}.${sql.identifier(getTableName(table))} in share row exclusive mode`,
    );
  }
}

/** Every staged row of the batch, its payload included, and every question and answer. */
async function stagedRows({ writer, batchId }: { writer: StoreWriter; batchId: string }) {
  const parts = await stagedPartNames({ batchId, writer });
  const items = await writer
    .select({
      fingerprint: storeImportItemTable.fingerprint,
      key: storeImportItemTable.itemKey,
      ordinal: storeImportItemTable.ordinal,
      part: storeImportItemTable.part,
      payload: storeImportItemTable.payload,
      summary: storeImportItemTable.summary,
    })
    .from(storeImportItemTable)
    .where(eq(storeImportItemTable.batchId, batchId));
  const questions = await stagedQuestions({ batchId, writer });
  const resolutions = await writer
    .select({ action: storeImportResolutionTable.action, questionId: storeImportResolutionTable.questionId })
    .from(storeImportResolutionTable)
    .innerJoin(storeImportQuestionTable, eq(storeImportQuestionTable.id, storeImportResolutionTable.questionId))
    .where(eq(storeImportQuestionTable.batchId, batchId));
  return { items, parts, questions, resolutions };
}

/**
 * The batch read back and planned again over the live store as this transaction sees it, and what it writes. The plan
 * must BE the staged one (`./importApplyPlan.ts`); the rows it writes are decided row by row
 * (`./importApplyEffects.ts`).
 *
 * @param stopOnConflict refuse on any append-only difference, rather than keeping each live row
 * @returns the application and its effects, or why the batch may not be applied
 */
export async function decided({
  writer,
  batch,
  stopOnConflict,
}: {
  writer: StoreWriter;
  batch: LockedBatch;
  stopOnConflict: boolean;
}): Promise<Result<{ application: ImportApplicationPlan; effects: ImportEffects }, StoreImportApplyError>> {
  const rows = await stagedRows({ batchId: batch.id, writer });
  const staged = reconstructStagedImport({ batch, ...rows });
  if (staged.isErr()) {
    return err(staged.error);
  }
  const contents = await readStoreContentsIn({ reader: { db: writer } });
  const live = contents.andThen((value) => liveRetained({ contents: value }));
  if (live.isErr()) {
    return err(
      StoreImportApplyErrors.applicationFailed({
        batchId: batch.id,
        register: "the live store",
        why: live.error.message,
      }),
    );
  }
  const imported = staged.value.imported;
  const replanned = planImport({ contentDigest: batch.contentDigest, imported, live: live.value });
  if (replanned.isErr()) {
    const why = replanned.error.message;
    return err(StoreImportApplyErrors.applicationFailed({ batchId: batch.id, register: "the plan", why }));
  }
  const statuses = importRowStatuses({ imported, live: live.value });
  if (statuses.isErr()) {
    const why = statuses.error.message;
    return err(StoreImportApplyErrors.applicationFailed({ batchId: batch.id, register: "the plan", why }));
  }
  const application = applicationReadiness({ replanned: replanned.value, staged: staged.value, stopOnConflict });
  if (application.isErr()) {
    return err(application.error);
  }
  return importApplicationEffects({ application: application.value, statuses: statuses.value }).map((effects) => ({
    application: application.value,
    effects,
  }));
}
