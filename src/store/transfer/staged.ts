/**
 * What staging an import writes, decided before anything is written: the approval checked against the plan,
 * every row the export carried flattened into one ordered list, and every question joined to the row it asks
 * about. An answer is validated here too, so the CLI and the store refuse the same thing for the same reason.
 * Pure.
 */
import { err, ok, type Result } from "#lib/result.js";

import type { BundleReading } from "./bundleRead.js";
import { contentDigest } from "./bundleRead.js";
import {
  actionsForImportQuestion,
  type ImportAction,
  type ImportPlan,
  type ImportQuestion,
  STORE_IMPORT_COMPARISON_VERSION,
} from "./compare.js";
import {
  type ImportActionInvalidError,
  type ImportApprovalMismatchError,
  type ImportQuestionStaleError,
  type StoreImportError,
  StoreImportErrors,
} from "./importErrors.js";
import { STORE_EXPORT_PARTS, type StoreExportPartKind } from "./parts.js";
import type { JsonValue } from "./retained.js";

/**
 * One staged row: where it sits in its part, its decoded row, and what an import compared it by.
 *
 * @internal reached only through {@link ImportStageDraft}
 */
export interface ImportStageItem {
  readonly part: StoreExportPartKind;
  readonly key: string;
  readonly ordinal: number;
  readonly payload: JsonValue;
  readonly fingerprint: string;
  readonly summary: string;
}

/** One staged question, as the store keeps it: the answers it takes follow from its kind. */
export interface ImportStageQuestion {
  readonly id: string;
  readonly part: StoreExportPartKind;
  readonly key: string;
  readonly kind: ImportQuestion["kind"];
  readonly imported: string;
  readonly live: string | null;
}

/**
 * Everything one staging writes, whole, in the order it is written. It carries no comparison version: the batch
 * records {@link STORE_IMPORT_COMPARISON_VERSION}, this build's own, so no caller can stage under another.
 */
export interface ImportStageDraft {
  readonly contentDigest: string;
  readonly planDigest: string;
  readonly manifested: boolean;
  /** Every part the export carried, an empty one included, in registry order. */
  readonly parts: readonly StoreExportPartKind[];
  readonly items: readonly ImportStageItem[];
  readonly questions: readonly ImportStageQuestion[];
}

/**
 * The plan, when the digest the owner approved is the one it carries now.
 *
 * @param approved the `sha256:` plan digest `--approve` named
 * @returns the plan, or `IMPORT_APPROVAL_MISMATCH` naming both digests
 */
export function approveImportPlan({
  approved,
  plan,
}: {
  approved: string;
  plan: ImportPlan;
}): Result<ImportPlan, ImportApprovalMismatchError> {
  if (approved !== plan.digest) {
    return err(StoreImportErrors.approvalMismatch({ approved, planned: plan.digest }));
  }
  return ok(plan);
}

/**
 * An answer, when it is one the question takes.
 *
 * @param question the question's id and kind, which decides the answers it takes
 * @param action the answer as given, unchecked
 * @returns the answer typed, or `IMPORT_ACTION_INVALID` naming the answers it does take
 */
export function validateImportAction({
  question,
  action,
}: {
  question: Pick<ImportQuestion, "id" | "kind">;
  action: string;
}): Result<ImportAction, ImportActionInvalidError> {
  const allowed = actionsForImportQuestion({ kind: question.kind });
  const found = allowed.find((candidate) => candidate === action);
  if (found === undefined) {
    return err(StoreImportErrors.actionInvalid({ action, allowed, questionId: question.id }));
  }
  return ok(found);
}

/**
 * Whether a staged question may be answered: only one in a batch staged under this build's comparison version.
 * One staged under another version, or before batches recorded one, asks something this build would not ask.
 *
 * @param questionId the staged question's `import-q-` id
 * @param stagedVersion its batch's `comparison_version`, `null` when it recorded none
 * @returns nothing when it may be answered, or `IMPORT_QUESTION_STALE`
 */
export function staleQuestionRefusal({
  questionId,
  stagedVersion,
}: {
  questionId: string;
  stagedVersion: number | null;
}): ImportQuestionStaleError | undefined {
  if (stagedVersion === STORE_IMPORT_COMPARISON_VERSION) {
    return undefined;
  }
  return StoreImportErrors.questionStale({
    currentVersion: STORE_IMPORT_COMPARISON_VERSION,
    questionId,
    stagedVersion,
  });
}

/** A staged item's columns compared here: all but its payload, which only the database compares exactly. */
type StagedItemColumns = Omit<ImportStageItem, "payload">;

/** What a batch already in the store holds, read back to be compared with the draft that would stage it. */
export interface StagedBatchContents {
  /** The comparison version the batch was staged under, or `null` for one staged before batches recorded it. */
  readonly comparisonVersion: number | null;
  readonly planDigest: string;
  readonly manifested: boolean;
  readonly parts: readonly StoreExportPartKind[];
  readonly items: readonly StagedItemColumns[];
  readonly questions: readonly ImportStageQuestion[];
}

/** One staged item as a comparable line: every column but its payload, as a JSON array so no field runs into the next. */
function itemLine({ item }: { item: StagedItemColumns }): string {
  return JSON.stringify([item.part, item.ordinal, item.key, item.fingerprint, item.summary]);
}

/** One staged question as a comparable line: every column the store keeps of it, an absent live side as `null`. */
function questionLine({ question }: { question: ImportStageQuestion }): string {
  return JSON.stringify([question.id, question.kind, question.part, question.key, question.imported, question.live]);
}

/** Whether two line lists hold the same lines, order aside. */
function sameLines({ left, right }: { left: readonly string[]; right: readonly string[] }): boolean {
  const sortedLeft = left.toSorted();
  const sortedRight = right.toSorted();
  return sortedLeft.length === sortedRight.length && sortedLeft.every((line, index) => line === sortedRight[index]);
}

/**
 * How a batch already holding a draft's content digest differs from what the draft stages, or `undefined` when it
 * holds exactly that: this build's comparison version, never merely the draft's, the same plan digest and manifest,
 * and every row and question column for column, summaries included. Payloads are NOT compared here: decoded into JavaScript, two jsonb numbers past 2^53 read as one, so the
 * caller compares them in the database, by jsonb equality, once this finds the rows one to one by part and ordinal.
 * A fingerprint the store never re-derives proves nothing about the payload beside it. A batch that differs was not written by
 * staging this export under this plan, so it is never reported as already staged — a batch staged under an earlier
 * plan included, since its questions answer a live store that has since moved.
 *
 * @param staged what the store's batch holds
 * @returns a short phrase naming the first difference, or `undefined`
 */
export function stagedBatchDifference({
  draft,
  staged,
}: {
  draft: ImportStageDraft;
  staged: StagedBatchContents;
}): string | undefined {
  if (staged.comparisonVersion === null) {
    return "it was staged before batches recorded their comparison version";
  }
  if (staged.comparisonVersion !== STORE_IMPORT_COMPARISON_VERSION) {
    return `it was staged under comparison version ${String(staged.comparisonVersion)}, and this build compares by version ${String(STORE_IMPORT_COMPARISON_VERSION)}`;
  }
  if (staged.planDigest !== draft.planDigest) {
    return `it was staged under plan ${staged.planDigest}`;
  }
  if (staged.manifested !== draft.manifested) {
    return "it was staged from a reading with a different manifest";
  }
  if (!sameLines({ left: staged.parts, right: draft.parts })) {
    return `it carries the parts ${staged.parts.toSorted().join(", ")}, not the export's ${draft.parts.toSorted().join(", ")}`;
  }
  const draftItems = draft.items.map((item) => itemLine({ item }));
  if (!sameLines({ left: staged.items.map((item) => itemLine({ item })), right: draftItems })) {
    return `it holds ${staged.items.length} rows that are not the export's ${draft.items.length}`;
  }
  const draftQuestions = draft.questions.map((question) => questionLine({ question }));
  if (!sameLines({ left: staged.questions.map((question) => questionLine({ question })), right: draftQuestions })) {
    return `it holds ${staged.questions.length} questions that are not the plan's ${draft.questions.length}`;
  }
  return undefined;
}

/** Every row the reading carried, parts in registry order and rows in the order their decoder produced them. */
function stageItems({ reading }: { reading: BundleReading }): readonly ImportStageItem[] {
  const items: ImportStageItem[] = [];
  for (const spec of STORE_EXPORT_PARTS) {
    const entries = reading.retained.get(spec.kind);
    if (entries === undefined) {
      continue;
    }
    entries.forEach((entry, ordinal) => {
      items.push({
        fingerprint: entry.fingerprint,
        key: entry.key,
        ordinal,
        part: spec.kind,
        payload: entry.payload,
        summary: entry.summary,
      });
    });
  }
  return items;
}

/**
 * What staging this reading under this plan writes: every row, and every question joined to its row. A plan made
 * under another comparison version is refused here, because the batch records this build's version and would
 * otherwise label another version's questions as this build's own.
 *
 * @param reading the export as read, every part's decoded rows beside their payloads
 * @param plan the plan already approved against the live store
 * @returns the draft, or `IMPORT_PLAN_STALE` for a plan of another comparison version, or
 *   `IMPORT_STAGE_INCONSISTENT` for a question whose row the reading does not carry
 */
export function importStageDraft({
  reading,
  plan,
}: {
  reading: BundleReading;
  plan: ImportPlan;
}): Result<ImportStageDraft, StoreImportError> {
  if (plan.comparisonVersion !== STORE_IMPORT_COMPARISON_VERSION) {
    return err(
      StoreImportErrors.planStale({
        currentVersion: STORE_IMPORT_COMPARISON_VERSION,
        planVersion: plan.comparisonVersion,
      }),
    );
  }
  const items = stageItems({ reading });
  const staged = new Set(items.map((item) => `${item.part}\u0000${item.key}`));
  const questions: ImportStageQuestion[] = [];
  for (const question of plan.questions) {
    if (!staged.has(`${question.part}\u0000${question.key}`)) {
      return err(
        StoreImportErrors.stageInconsistent({ key: question.key, part: question.part, questionId: question.id }),
      );
    }
    questions.push({
      id: question.id,
      imported: question.imported,
      key: question.key,
      kind: question.kind,
      live: question.live,
      part: question.part,
    });
  }
  return ok({
    contentDigest: contentDigest({ parts: reading.parts }),
    items,
    manifested: reading.manifest !== null,
    parts: STORE_EXPORT_PARTS.map((spec) => spec.kind).filter((kind) => reading.retained.has(kind)),
    planDigest: plan.digest,
    questions,
  });
}
