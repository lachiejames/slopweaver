/**
 * Staging an export whole into the staged-import tables; the owner's answers to its questions are
 * `importAnswers.ts`.
 *
 * Staging is ONE transaction, so a batch is never half there: its parts, items and questions commit with it or not at
 * all. The unique pair of content and plan digest is what settles two stagings of one export under one plan racing
 * each other, not a read beforehand: the loser's insert fails on that constraint, and the loser reports the winner's
 * batch as already staged rather than a query failure. The same export planned against a store that has since moved
 * is a batch of its own. A batch is reported already staged only when it holds exactly what this export stages under
 * this plan; one holding both digests but anything else is refused, never trusted.
 */
import { and, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonStringify } from "#lib/safeJson.js";

import type { StoreClient, StoreWriter } from "../client.js";
import { StoreErrors } from "../errors.js";
import {
  storeImportBatchTable,
  storeImportItemTable,
  storeImportPartTable,
  storeImportQuestionTable,
} from "../schema/importStaging.js";

import { STORE_IMPORT_COMPARISON_VERSION } from "./compare.js";
import { type StoreImportError, StoreImportErrors } from "./importErrors.js";
import { realTablesOnly, stagingGuardsInstalled } from "./importSession.js";
import { type ImportStageDraft, stagedBatchDifference } from "./staged.js";
import { stagedPartNames, stagedQuestions } from "./stagedBatchRead.js";

/** Rows per insert statement, well inside Postgres's 65,535 bind parameters at seven columns a row. */
const INSERT_CHUNK = 500;

/** The batch constraint whose violation means another staging of the same export under the same plan committed first. */
const CONTENT_DIGEST_CONSTRAINT = "uq_store_import_batch_content_plan";

/** What one staging did: wrote a new batch, or found the export already staged and wrote nothing. */
export type StageImportOutcome =
  | {
      readonly outcome: "staged";
      readonly batchId: string;
      readonly items: number;
      readonly questions: number;
      readonly writes: number;
    }
  | {
      readonly outcome: "already-staged";
      readonly batchId: string;
      readonly items: number;
      readonly questions: number;
      readonly writes: 0;
    };

/** Whether a thrown value is, at any depth, the content-digest unique violation. */
function isContentDigestRace({ cause }: { cause: unknown }): boolean {
  let current: unknown = cause;
  while (current instanceof Error) {
    if ("constraint_name" in current && current.constraint_name === CONTENT_DIGEST_CONSTRAINT) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** A staged batch's parts, its item columns, payload aside, and its questions: what {@link stagedBatchDifference} compares. */
async function batchRows({ writer, batchId }: { writer: StoreWriter; batchId: string }) {
  const parts = await stagedPartNames({ batchId, writer });
  const items = await writer
    .select({
      fingerprint: storeImportItemTable.fingerprint,
      key: storeImportItemTable.itemKey,
      ordinal: storeImportItemTable.ordinal,
      part: storeImportItemTable.part,
      summary: storeImportItemTable.summary,
    })
    .from(storeImportItemTable)
    .where(eq(storeImportItemTable.batchId, batchId));
  const questions = await stagedQuestions({ batchId, writer });
  return { items, parts, questions };
}

/**
 * The batch already staged for the draft's content and plan digests, `null` when none is, or `IMPORT_BATCH_MISMATCH`
 * when one holds both but not exactly what the draft stages — a batch written by hand rather than by staging this
 * export under this plan is never reported as already staged. Run inside a transaction: the batch row is held `FOR
 * SHARE` until it ends, so a whole-batch removal either commits before the read and leaves no batch to find, or waits
 * until the read is done — the item and question reads, each a fresh snapshot under read committed, never see a
 * batch that has gone.
 */
async function stagedBatch({
  writer,
  draft,
}: {
  writer: StoreWriter;
  draft: ImportStageDraft;
}): Promise<Result<Extract<StageImportOutcome, { outcome: "already-staged" }> | null, StoreImportError>> {
  const [batch] = await writer
    .select({
      comparisonVersion: storeImportBatchTable.comparisonVersion,
      id: storeImportBatchTable.id,
      manifested: storeImportBatchTable.manifested,
      planDigest: storeImportBatchTable.planDigest,
    })
    .from(storeImportBatchTable)
    .where(
      and(
        eq(storeImportBatchTable.contentDigest, draft.contentDigest),
        eq(storeImportBatchTable.planDigest, draft.planDigest),
      ),
    )
    .for("share");
  if (batch === undefined) {
    return ok(null);
  }
  const { items, parts, questions } = await batchRows({ batchId: batch.id, writer });
  const difference = stagedBatchDifference({
    draft,
    staged: {
      comparisonVersion: batch.comparisonVersion,
      items,
      manifested: batch.manifested,
      parts,
      planDigest: batch.planDigest,
      questions,
    },
  });
  if (difference !== undefined) {
    return err(StoreImportErrors.batchMismatch({ batchId: batch.id, contentDigest: draft.contentDigest, difference }));
  }
  if (!(await payloadsMatch({ batchId: batch.id, draft, writer }))) {
    return err(
      StoreImportErrors.batchMismatch({
        batchId: batch.id,
        contentDigest: draft.contentDigest,
        difference: "its rows' payloads are not the export's",
      }),
    );
  }
  return ok({
    batchId: batch.id,
    items: items.length,
    outcome: "already-staged",
    questions: questions.length,
    writes: 0,
  });
}

/**
 * Whether every draft row's payload equals, by Postgres's own jsonb equality, the payload the batch holds at the same
 * part and ordinal. Compared in the database because postgres.js decodes jsonb with `JSON.parse`, under which two
 * numbers past 2^53 read as one. Each chunk is sent as the JSON text staging would write and cast to jsonb there, so
 * nothing is rounded on the way in. Called once {@link stagedBatchDifference} found the rows one to one by part and
 * ordinal, so a chunk matches exactly when its every row is counted.
 */
async function payloadsMatch({
  writer,
  batchId,
  draft,
}: {
  writer: StoreWriter;
  batchId: string;
  draft: ImportStageDraft;
}): Promise<boolean> {
  for (let start = 0; start < draft.items.length; start += INSERT_CHUNK) {
    const chunk = draft.items.slice(start, start + INSERT_CHUNK);
    const expected = safeJsonStringify({
      label: "store import payload check",
      value: chunk.map((item) => ({ ordinal: item.ordinal, part: item.part, payload: item.payload })),
    });
    const [counted] = await writer.execute<{ matching: number }>(
      sql`select count(*)::int as "matching"
          from jsonb_to_recordset(${expected}::jsonb) as d(part text, ordinal integer, payload jsonb)
          join public.store_import_item i
            on i.batch_id = ${batchId} and i.part = d.part and i.ordinal = d.ordinal and i.payload = d.payload`,
    );
    if (counted!.matching !== chunk.length) {
      return false;
    }
  }
  return true;
}

/** Insert a draft's batch, parts, items and questions inside the caller's transaction. */
async function insertDraft({
  writer,
  draft,
}: {
  writer: StoreWriter;
  draft: ImportStageDraft;
}): Promise<StageImportOutcome> {
  const [batch] = await writer
    .insert(storeImportBatchTable)
    .values({
      comparisonVersion: STORE_IMPORT_COMPARISON_VERSION,
      contentDigest: draft.contentDigest,
      manifested: draft.manifested,
      planDigest: draft.planDigest,
    })
    .returning({ id: storeImportBatchTable.id });
  const batchId = batch!.id;
  // At most seven, one per part kind, so one statement.
  if (draft.parts.length > 0) {
    await writer.insert(storeImportPartTable).values(draft.parts.map((part) => ({ batchId, part })));
  }
  for (let start = 0; start < draft.items.length; start += INSERT_CHUNK) {
    const chunk = draft.items.slice(start, start + INSERT_CHUNK);
    await writer.insert(storeImportItemTable).values(
      chunk.map((item) => ({
        batchId,
        fingerprint: item.fingerprint,
        itemKey: item.key,
        ordinal: item.ordinal,
        part: item.part,
        payload: item.payload,
        summary: item.summary,
      })),
    );
  }
  for (let start = 0; start < draft.questions.length; start += INSERT_CHUNK) {
    const chunk = draft.questions.slice(start, start + INSERT_CHUNK);
    await writer.insert(storeImportQuestionTable).values(
      chunk.map((question) => ({
        batchId,
        id: question.id,
        importedSummary: question.imported,
        itemKey: question.key,
        kind: question.kind,
        liveSummary: question.live,
        part: question.part,
      })),
    );
  }
  const items = draft.items.length;
  const questions = draft.questions.length;
  return { batchId, items, outcome: "staged", questions, writes: 1 + draft.parts.length + items + questions };
}

/**
 * Stage a draft in one transaction, or report the batch that already holds its export.
 *
 * @param client an open store connection
 * @param draft everything the staging writes, already checked against the approved plan
 * @returns what the staging did, or the store's typed failure
 */
export async function stageImport({
  client,
  draft,
}: {
  client: StoreClient;
  draft: ImportStageDraft;
}): Promise<Result<StageImportOutcome, StoreImportError>> {
  try {
    return await client.db.transaction(
      async (writer: StoreWriter): Promise<Result<StageImportOutcome, StoreImportError>> => {
        await realTablesOnly({ writer });
        const guarded = await stagingGuardsInstalled({ writer });
        if (guarded.isErr()) {
          return err(guarded.error);
        }
        const already = await stagedBatch({ draft, writer });
        if (already.isErr() || already.value !== null) {
          return already.map((found) => found!);
        }
        return ok(await insertDraft({ draft, writer }));
      },
    );
  } catch (cause) {
    if (!isContentDigestRace({ cause })) {
      return err(StoreErrors.queryFailed({ cause, what: "store import staging" }));
    }
  }
  try {
    const winner = await client.db.transaction(async (writer: StoreWriter) => {
      await realTablesOnly({ writer });
      return stagedBatch({ draft, writer });
    });
    if (winner.isOk() && winner.value === null) {
      return err(
        StoreErrors.queryFailed({
          cause: new Error("the batch that won the staging race was removed before it could be read"),
          what: "store import staging, re-reading the batch that won",
        }),
      );
    }
    return winner.map((found) => found!);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "store import staging, re-reading the batch that won" }));
  }
}
