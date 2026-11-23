/**
 * The two reads of a staged batch that staging (`./importStore.ts`, comparing a batch already staged) and an apply
 * (`./importApplyRead.ts`, reconstructing the batch it writes) both make: the batch's part names and every question it
 * raised. Each runs inside the caller's transaction; the items are read by each caller itself, because staging
 * compares them without their payloads and an apply needs the payloads it writes.
 */
import { eq } from "drizzle-orm";

import type { StoreWriter } from "../client.js";
import { storeImportPartTable, storeImportQuestionTable } from "../schema/importStaging.js";

type QuestionColumns = typeof storeImportQuestionTable.$inferSelect;

/** One staged question, under the names the staged-batch comparison and reconstruction read it by. */
export interface StagedQuestionRow {
  readonly id: QuestionColumns["id"];
  readonly imported: QuestionColumns["importedSummary"];
  readonly key: QuestionColumns["itemKey"];
  readonly kind: QuestionColumns["kind"];
  readonly live: QuestionColumns["liveSummary"];
  readonly part: QuestionColumns["part"];
}

/**
 * The part names a staged batch holds.
 *
 * @param writer the caller's open transaction
 * @param batchId the staged batch
 * @returns every part the batch staged, in the order the table answers
 */
export async function stagedPartNames({
  writer,
  batchId,
}: {
  writer: StoreWriter;
  batchId: string;
}): Promise<(typeof storeImportPartTable.$inferSelect)["part"][]> {
  const parts = await writer
    .select({ part: storeImportPartTable.part })
    .from(storeImportPartTable)
    .where(eq(storeImportPartTable.batchId, batchId));
  return parts.map((row) => row.part);
}

/**
 * Every question a staged batch raised.
 *
 * @param writer the caller's open transaction
 * @param batchId the staged batch
 * @returns each question with its kind, its row's key and part, and both summaries it shows
 */
export async function stagedQuestions({
  writer,
  batchId,
}: {
  writer: StoreWriter;
  batchId: string;
}): Promise<StagedQuestionRow[]> {
  return writer
    .select({
      id: storeImportQuestionTable.id,
      imported: storeImportQuestionTable.importedSummary,
      key: storeImportQuestionTable.itemKey,
      kind: storeImportQuestionTable.kind,
      live: storeImportQuestionTable.liveSummary,
      part: storeImportQuestionTable.part,
    })
    .from(storeImportQuestionTable)
    .where(eq(storeImportQuestionTable.batchId, batchId));
}
