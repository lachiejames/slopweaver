/**
 * Whether a staged import may apply, decided before anything is written. A batch is read back whole — every staged
 * row re-decoded and checked against what was staged, every question joined to its row, every answer to its
 * question — and the export it holds is planned again against the live store as it is now. It applies only when
 * that fresh plan IS the staged one, digest and questions alike, and every question an apply needs answered has its
 * answer. An append-only difference never blocks: its live row stands, the imported one stays staged, and the
 * difference is reported — unless the caller asked a strict apply to stop on one. Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ImportAction, type ImportPlan, STORE_IMPORT_COMPARISON_VERSION } from "./compare.js";
import { type AppendOnlyDifference, type StoreImportApplyError, StoreImportApplyErrors } from "./importApplyErrors.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import type { RetainedEntry } from "./retained.js";
import { type ImportStageQuestion, validateImportAction } from "./staged.js";
import { type StagedItemRow, type StagedValue, stagedPartEntries } from "./stagedDecode.js";

/** A staged batch's own columns. */
export interface StagedBatchHead {
  readonly id: string;
  readonly contentDigest: string;
  readonly planDigest: string;
  /** `null` for a batch staged before batches recorded their comparison version. */
  readonly comparisonVersion: number | null;
}

/** One recorded answer, as the store holds it. */
export interface StagedResolutionRow {
  readonly questionId: string;
  readonly action: string;
}

/** A staged batch read back: its export's parts as entries, its questions, and the answers they hold. */
export interface StagedImport {
  readonly batch: StagedBatchHead;
  /** Every part the export carried, an empty one included; a part it did not carry is absent. */
  readonly imported: ReadonlyMap<StoreExportPartKind, readonly RetainedEntry[]>;
  /** Every carried part's rows as the domain values they decoded to, by key. */
  readonly values: ReadonlyMap<StoreExportPartKind, ReadonlyMap<string, StagedValue>>;
  readonly questions: readonly ImportStageQuestion[];
  readonly answers: ReadonlyMap<string, ImportAction>;
}

/** What an apply that may go ahead applies, and what it reports. */
export interface ImportApplicationPlan {
  readonly staged: StagedImport;
  /** The fresh plan, which is the staged one. */
  readonly plan: ImportPlan;
  /** Every append-only row the live store holds differently, in plan order, answered or not. */
  readonly appendOnlyDifferences: readonly AppendOnlyDifference[];
  /** The alignment questions still unacknowledged: reported, never waited on. */
  readonly openAlignmentQuestionIds: readonly string[];
}

/** One part's place and key, as one string no key can run into. */
function rowKey({ part, key }: { part: StoreExportPartKind; key: string }): string {
  return `${part}\u0000${key}`;
}

/** Every answer by its question, each one its question takes, or why the batch does not hang together. */
function answersOf({
  batchId,
  questions,
  resolutions,
}: {
  batchId: string;
  questions: readonly ImportStageQuestion[];
  resolutions: readonly StagedResolutionRow[];
}): Result<ReadonlyMap<string, ImportAction>, StoreImportApplyError> {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answers = new Map<string, ImportAction>();
  for (const resolution of resolutions) {
    const question = byId.get(resolution.questionId);
    if (question === undefined || answers.has(resolution.questionId)) {
      const why = `an answer names question ${resolution.questionId}, which is not one staged question awaiting one`;
      return err(StoreImportApplyErrors.batchIncomplete({ batchId, why }));
    }
    const action = validateImportAction({ action: resolution.action, question });
    if (action.isErr()) {
      return err(StoreImportApplyErrors.batchIncomplete({ batchId, why: action.error.message }));
    }
    answers.set(question.id, action.value);
  }
  return ok(answers);
}

/**
 * Read a staged batch back into the export it holds, the questions it asked and the answers they hold.
 *
 * @param batch the batch's own columns
 * @param parts every part the batch records the export carrying
 * @param items every staged row, in any order
 * @param questions every staged question
 * @param resolutions every recorded answer
 * @returns the staged import, or `IMPORT_STAGED_PAYLOAD_INVALID` for a row that is not what was staged, or
 *   `IMPORT_STAGED_BATCH_INCOMPLETE` for a row, question or answer naming what the batch does not hold
 */
export function reconstructStagedImport({
  batch,
  parts,
  items,
  questions,
  resolutions,
}: {
  batch: StagedBatchHead;
  parts: readonly StoreExportPartKind[];
  items: readonly StagedItemRow[];
  questions: readonly ImportStageQuestion[];
  resolutions: readonly StagedResolutionRow[];
}): Result<StagedImport, StoreImportApplyError> {
  const carried = new Set(parts);
  const stray = items.find((item) => !carried.has(item.part));
  if (stray !== undefined) {
    const why = `row ${stray.key} is of ${stray.part}, a part the batch records no export carrying`;
    return err(StoreImportApplyErrors.batchIncomplete({ batchId: batch.id, why }));
  }
  const imported = new Map<StoreExportPartKind, readonly RetainedEntry[]>();
  const values = new Map<StoreExportPartKind, ReadonlyMap<string, StagedValue>>();
  for (const spec of STORE_EXPORT_PARTS.filter((one) => carried.has(one.kind))) {
    const read = stagedPartEntries({ part: spec.kind, rows: items.filter((item) => item.part === spec.kind) });
    if (read.isErr()) {
      return err(read.error);
    }
    imported.set(spec.kind, read.value.entries);
    values.set(spec.kind, read.value.values);
  }
  const held = new Set(items.map((item) => rowKey(item)));
  const orphan = questions.find((question) => !held.has(rowKey(question)));
  if (orphan !== undefined) {
    const why = `question ${orphan.id} asks about ${orphan.part} row ${orphan.key}, which the batch does not hold`;
    return err(StoreImportApplyErrors.batchIncomplete({ batchId: batch.id, why }));
  }
  return answersOf({ batchId: batch.id, questions, resolutions }).map((answers) => ({
    answers,
    batch,
    imported,
    questions,
    values,
  }));
}

/** One question as the comparable line the store keeps of it. */
function questionLine({ question }: { question: ImportStageQuestion }): string {
  return JSON.stringify([question.id, question.kind, question.part, question.key, question.imported, question.live]);
}

/**
 * Why the staged batch is not the fresh plan, or `undefined` when it is: its comparison version, its digest (every
 * row's classification) or its questions moved. The needs a written row has are NOT part of this — they are judged
 * on the fresh plan alone, so a provider that appeared since staging lets the batch apply, and one that went refuses
 * it as unmet rather than stale.
 */
function staleness({ staged, replanned }: { staged: StagedImport; replanned: ImportPlan }): string | undefined {
  const version = staged.batch.comparisonVersion;
  if (version === null) {
    return "it was staged before batches recorded their comparison version";
  }
  if (version !== STORE_IMPORT_COMPARISON_VERSION) {
    return `it was staged under comparison version ${String(version)}, and this build compares by version ${String(STORE_IMPORT_COMPARISON_VERSION)}`;
  }
  if (replanned.comparisonVersion !== version) {
    return `its fresh plan was compared by version ${String(replanned.comparisonVersion)}, not the staged version ${String(version)}`;
  }
  if (replanned.digest !== staged.batch.planDigest) {
    return "it no longer plans to the staged plan: the live store has moved since it was staged, or a staged row is not one the plan was made of";
  }
  const freshLines = replanned.questions.map((question) => questionLine({ question })).toSorted();
  const stagedLines = staged.questions.map((question) => questionLine({ question })).toSorted();
  if (freshLines.join("\n") !== stagedLines.join("\n")) {
    return "its staged questions are not the ones its plan asks";
  }
  return undefined;
}

/**
 * Whether a staged import may apply now, and what it reports when it does.
 *
 * Readiness models the REGISTERS' rules — every key, every answer, every link a written row needs — and not the
 * database's own: a column's type or check a decoded row breaks (a recording id the decoder took as a string that is
 * not a UUID), an exhausted `seq` sequence, a full disk or a dropped connection still fails the write, and the apply,
 * being one transaction, then rolls the whole of it back, its receipt included (`IMPORT_APPLICATION_FAILED`).
 *
 * @param staged the batch read back by {@link reconstructStagedImport}
 * @param replanned its export planned again against the live store as it is now
 * @param stopOnConflict refuse the whole apply on any append-only difference, rather than keeping the live row
 * @returns the application plan, or `IMPORT_BATCH_STALE` when the fresh plan's comparison version, digest or
 *   questions are not the staged ones, `IMPORT_DEPENDENCY_UNMET` when a row it would write needs one nothing live or
 *   written provides NOW (judged on the fresh plan, whatever the staged one said),
 *   `IMPORT_APPEND_ONLY_CONFLICT` for a strict apply meeting a difference, or `IMPORT_QUESTIONS_OPEN` naming every
 *   activation and conflict still unanswered
 */
export function applicationReadiness({
  staged,
  replanned,
  stopOnConflict,
}: {
  staged: StagedImport;
  replanned: ImportPlan;
  stopOnConflict: boolean;
}): Result<ImportApplicationPlan, StoreImportApplyError> {
  const batchId = staged.batch.id;
  const why = staleness({ replanned, staged });
  if (why !== undefined) {
    const stagedPlanDigest = staged.batch.planDigest;
    return err(
      StoreImportApplyErrors.batchStale({ batchId, currentPlanDigest: replanned.digest, stagedPlanDigest, why }),
    );
  }
  const differences: AppendOnlyDifference[] = replanned.questions
    .filter((question) => question.kind === "alignment")
    .map((question) => ({
      current: question.live!,
      imported: question.imported,
      key: question.key,
      part: question.part,
      questionId: question.id,
      resolved: staged.answers.has(question.id),
    }));
  if (replanned.unmet.length > 0) {
    const alignmentQuestionIds = differences.map((one) => one.questionId);
    return err(StoreImportApplyErrors.dependencyUnmet({ alignmentQuestionIds, batchId, unmet: replanned.unmet }));
  }
  if (stopOnConflict && differences.length > 0) {
    return err(StoreImportApplyErrors.appendOnlyConflict({ batchId, differences }));
  }
  const open = replanned.questions.filter(
    (question) => question.kind !== "alignment" && !staged.answers.has(question.id),
  );
  if (open.length > 0) {
    return err(StoreImportApplyErrors.questionsOpen({ batchId, questionIds: open.map((question) => question.id) }));
  }
  return ok({
    appendOnlyDifferences: differences,
    openAlignmentQuestionIds: differences.filter((one) => !one.resolved).map((one) => one.questionId),
    plan: replanned,
    staged,
  });
}
