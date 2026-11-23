/**
 * The owner's answers to a staged import's questions: recording one, never changed once recorded, and listing the
 * questions still unanswered. An answer is immutable the way a staged batch is: the question's own primary key on
 * the resolution table takes one row, an insert that meets it writes nothing, and a second answer that differs,
 * racing or not, is refused by name.
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreReader, StoreWriter } from "../client.js";
import { StoreErrors } from "../errors.js";
import {
  storeImportBatchTable,
  storeImportQuestionTable,
  storeImportResolutionTable,
} from "../schema/importStaging.js";

import {
  actionsForImportQuestion,
  type ImportAction,
  type ImportQuestion,
  STORE_IMPORT_COMPARISON_VERSION,
} from "./compare.js";
import { type StoreImportError, StoreImportErrors } from "./importErrors.js";
import { realTablesOnly, stagingGuardsInstalled } from "./importSession.js";
import type { StoreExportPartKind } from "./parts.js";
import { staleQuestionRefusal, validateImportAction } from "./staged.js";

/** What recording one answer did: wrote it, or found the same answer already recorded and wrote nothing. */
export type RecordImportResolutionOutcome =
  | { readonly outcome: "recorded"; readonly questionId: string; readonly action: ImportAction; readonly writes: 1 }
  | {
      readonly outcome: "already-recorded";
      readonly questionId: string;
      readonly action: ImportAction;
      readonly writes: 0;
    };

/** One staged question nobody has answered yet, with the batch it belongs to. */
export interface UnresolvedImportQuestion {
  readonly batchId: string;
  readonly questionId: string;
  readonly kind: ImportQuestion["kind"];
  readonly part: StoreExportPartKind;
  readonly key: string;
  readonly imported: string;
  /** The live row's line for a conflict, `null` for an activation. */
  readonly current: string | null;
  readonly actions: readonly ImportAction[];
  readonly stagedAtIso: string;
}

/** Record one answer inside the caller's transaction, or refuse it by name. */
async function recordWithin({
  writer,
  questionId,
  action,
}: {
  writer: StoreWriter;
  questionId: string;
  action: string;
}): Promise<Result<RecordImportResolutionOutcome, StoreImportError>> {
  await realTablesOnly({ writer });
  const guarded = await stagingGuardsInstalled({ writer });
  if (guarded.isErr()) {
    return err(guarded.error);
  }
  // The batch row is held `FOR SHARE` with the question, so its comparison version cannot move under the answer.
  const [question] = await writer
    .select({
      comparisonVersion: storeImportBatchTable.comparisonVersion,
      id: storeImportQuestionTable.id,
      kind: storeImportQuestionTable.kind,
    })
    .from(storeImportQuestionTable)
    .innerJoin(storeImportBatchTable, eq(storeImportBatchTable.id, storeImportQuestionTable.batchId))
    .where(eq(storeImportQuestionTable.id, questionId))
    .for("share", { of: storeImportBatchTable });
  if (question === undefined) {
    return err(StoreImportErrors.notStaged({ questionId }));
  }
  const stale = staleQuestionRefusal({ questionId, stagedVersion: question.comparisonVersion });
  if (stale !== undefined) {
    return err(stale);
  }
  const valid = validateImportAction({ action, question });
  if (valid.isErr()) {
    return err(valid.error);
  }
  // The insert is what decides, never a read before it: two answers racing both read nothing, so a read-then-insert
  // let the loser hit the primary key and report a query failure. On a conflict the insert waits for the
  // winner to commit and writes nothing, and the read below, a fresh snapshot, sees what the winner recorded.
  const inserted = await writer
    .insert(storeImportResolutionTable)
    .values({ action: valid.value, questionId, questionKind: question.kind })
    .onConflictDoNothing({ target: storeImportResolutionTable.questionId })
    .returning({ questionId: storeImportResolutionTable.questionId });
  if (inserted.length > 0) {
    return ok({ action: valid.value, outcome: "recorded", questionId, writes: 1 });
  }
  const [recorded] = await writer
    .select({ action: storeImportResolutionTable.action })
    .from(storeImportResolutionTable)
    .where(eq(storeImportResolutionTable.questionId, questionId));
  // A conflict with no row left is only a batch removed between the two statements, its answers cascading with it.
  if (recorded === undefined) {
    return err(StoreImportErrors.notStaged({ questionId }));
  }
  if (recorded.action === valid.value) {
    return ok({ action: valid.value, outcome: "already-recorded", questionId, writes: 0 });
  }
  return err(StoreImportErrors.alreadyResolved({ questionId, recorded: recorded.action, requested: action }));
}

/**
 * Record the owner's answer to one staged question. An answer is never changed: the same answer again writes
 * nothing, and a different one is refused.
 *
 * @param client an open store connection
 * @param questionId the staged question's `import-q-` id
 * @param action the answer as given, checked against the question's kind
 * @returns what was recorded, or why it was refused
 */
export async function recordImportResolution({
  client,
  questionId,
  action,
}: {
  client: StoreClient;
  questionId: string;
  action: string;
}): Promise<Result<RecordImportResolutionOutcome, StoreImportError>> {
  try {
    return await client.db.transaction(
      async (writer: StoreWriter): Promise<Result<RecordImportResolutionOutcome, StoreImportError>> =>
        recordWithin({ action, questionId, writer }),
    );
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "store import resolution" }));
  }
}

/**
 * Every staged question with no answer yet, oldest batch first, then in the order each was staged. Only a batch
 * staged under this build's comparison version is listed: one staged under another version asks what this build
 * would not ask, and answering it would settle a question nobody is being asked. Part 5's apply raises the one
 * question such a batch earns, to stage it again.
 *
 * @param client anything a read runs against
 * @returns the open questions, or the store's typed failure
 */
export async function listUnresolvedImportQuestions({
  client,
}: {
  client: StoreReader;
}): Promise<Result<readonly UnresolvedImportQuestion[], StoreImportError>> {
  try {
    const rows = await client.db
      .select({
        batchId: storeImportQuestionTable.batchId,
        current: storeImportQuestionTable.liveSummary,
        imported: storeImportQuestionTable.importedSummary,
        key: storeImportQuestionTable.itemKey,
        kind: storeImportQuestionTable.kind,
        part: storeImportQuestionTable.part,
        questionId: storeImportQuestionTable.id,
        stagedAt: storeImportBatchTable.stagedAt,
      })
      .from(storeImportQuestionTable)
      .innerJoin(storeImportBatchTable, eq(storeImportBatchTable.id, storeImportQuestionTable.batchId))
      .leftJoin(
        storeImportResolutionTable,
        and(
          eq(storeImportResolutionTable.questionId, storeImportQuestionTable.id),
          eq(storeImportResolutionTable.questionKind, storeImportQuestionTable.kind),
        ),
      )
      .where(
        and(
          isNull(storeImportResolutionTable.questionId),
          eq(storeImportBatchTable.comparisonVersion, STORE_IMPORT_COMPARISON_VERSION),
        ),
      )
      .orderBy(
        asc(storeImportBatchTable.stagedAt),
        asc(storeImportQuestionTable.createdAt),
        asc(storeImportQuestionTable.id),
      );
    return ok(
      rows.map(({ stagedAt, ...row }) => ({
        ...row,
        actions: actionsForImportQuestion({ kind: row.kind }),
        stagedAtIso: stagedAt.toISOString(),
      })),
    );
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "store import questions read" }));
  }
}
