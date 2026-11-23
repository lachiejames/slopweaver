/**
 * Appending an import's new memories and recalls inside the caller's transaction — the writer `store import
 * --apply` calls, never one that opens a transaction of its own.
 *
 * Both tables are append-only, so an import only ever ADDS: a row whose identity the store already holds never
 * reaches here (the comparison made it identical, or an alignment question that keeps the current row). Each
 * imported row keeps its own identity and both instants, because those are what the comparison fingerprints, so a
 * later export of this store reads the row as the same one; only `seq` is this store's, taken fresh from the
 * sequence. A restore's explicit `seq` and `setval` (`./memoryRestoreStore.ts`) is deliberately not the path: that
 * file records why `setval` is not transactional. Neither is `nextval`: an apply that rolls back after this ran leaves
 * no row written and both sequences advanced, which costs a gap in `seq` and never a collision. `seq` orders rows and
 * nothing reads it as a count, so the gap is the whole of what a rolled-back apply leaves here.
 *
 * Every reference is checked against the register AS THIS TRANSACTION SEES IT, after the memories land: a
 * recording that retires a claim names one of its own kind, and a recall names a recording of the claim it counts.
 */
import { eq, inArray } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreWriter } from "../store/client.js";
import { memoriesTable } from "../store/schema/memories.js";
import { memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { latestRecordingOf } from "./memoryRecordStore.js";
import type { RecallRecord } from "./recallRestore.js";
import type { RestoredRecording } from "./restore.js";
import { supersessionCheck } from "./supersession.js";

/** How many rows one insert carries, well under Postgres's bound-parameter ceiling for either table's width. */
const INSERT_BATCH = 500;

/** What an append wrote: one count per table, each a row inserted. */
export interface KnowledgeImportWriteOutcome {
  readonly memories: number;
  readonly recalls: number;
}

/** The rows in batches of {@link INSERT_BATCH}, in order. */
function batches<Row>({ rows }: { rows: readonly Row[] }): readonly (readonly Row[])[] {
  const out: Row[][] = [];
  for (let at = 0; at < rows.length; at += INSERT_BATCH) {
    out.push(rows.slice(at, at + INSERT_BATCH));
  }
  return out;
}

/**
 * Every imported recording that retires a claim may retire it: the claim is another one than its own, as a restore
 * holds it (`./restoreMerge.ts`), exists here, and is recorded under its own kind and NO other. The import's plan
 * holds a claim to that one kind (`../store/transfer/closure.ts`), since which recording is latest is this store's
 * order rather than the export's, so this writer refuses exactly what that plan refuses.
 */
async function supersessionsHold({
  writer,
  memories,
}: {
  writer: StoreWriter;
  memories: readonly RestoredRecording[];
}): Promise<Result<true, KnowledgeError>> {
  for (const row of memories) {
    if (row.supersedes === null) {
      continue;
    }
    const supersedes = row.supersedes;
    if (supersedes === row.id) {
      return err(KnowledgeErrors.supersedesRefused({ supersedes, why: "a recording never retires its own claim" }));
    }
    const target = await latestRecordingOf({ client: { db: writer }, memoryId: supersedes });
    const checked = supersessionCheck({ row, target });
    if (checked.isErr()) {
      return err(checked.error);
    }
    const kinds = await writer
      .selectDistinct({ kind: memoriesTable.kind })
      .from(memoriesTable)
      .where(eq(memoriesTable.id, supersedes));
    if (kinds.length > 1) {
      const held = kinds.map((one) => one.kind).toSorted();
      return err(
        KnowledgeErrors.supersedesRefused({
          supersedes,
          why: `it is recorded as ${held.join(" and as ")}, not one kind`,
        }),
      );
    }
  }
  return ok(true);
}

/** Every imported recall names a recording this store holds, and that recording is of the claim the recall counts. */
async function recallReferencesHold({
  writer,
  recalls,
}: {
  writer: StoreWriter;
  recalls: readonly RecallRecord[];
}): Promise<Result<true, KnowledgeError>> {
  const wanted = [...new Set(recalls.map((recall) => recall.recordingId))];
  const held = new Map<string, string>();
  for (const batch of batches({ rows: wanted })) {
    const rows = await writer
      .select({ id: memoriesTable.id, recordingId: memoriesTable.recordingId })
      .from(memoriesTable)
      .where(inArray(memoriesTable.recordingId, [...batch]));
    for (const row of rows) {
      held.set(row.recordingId, row.id);
    }
  }
  for (const recall of recalls) {
    const claim = held.get(recall.recordingId);
    if (claim !== recall.memoryId) {
      const found = claim === undefined ? "no recording carries that id" : `that recording is of claim ${claim}`;
      return err(
        KnowledgeErrors.corruptRecording({
          recordingId: recall.recordingId,
          why: `recall ${recall.recallId} counts claim ${recall.memoryId}, but ${found}`,
        }),
      );
    }
  }
  return ok(true);
}

/** The memories, inserted with a fresh `seq` each and everything else as imported. */
async function insertMemories({
  writer,
  memories,
}: {
  writer: StoreWriter;
  memories: readonly RestoredRecording[];
}): Promise<number> {
  let written = 0;
  for (const batch of batches({ rows: memories })) {
    const values = batch.map(({ seq: _seq, ...row }) => row);
    const inserted = await writer.insert(memoriesTable).values(values).returning({ id: memoriesTable.recordingId });
    written += inserted.length;
  }
  return written;
}

/** The recalls, inserted with a fresh `seq` each and everything else as imported. */
async function insertRecalls({
  writer,
  recalls,
}: {
  writer: StoreWriter;
  recalls: readonly RecallRecord[];
}): Promise<number> {
  let written = 0;
  for (const batch of batches({ rows: recalls })) {
    const values = batch.map(({ seq: _seq, ...row }) => row);
    const inserted = await writer
      .insert(memoryRecallsTable)
      .values(values)
      .returning({ id: memoryRecallsTable.recallId });
    written += inserted.length;
  }
  return written;
}

/**
 * Append an import's new memories, then its new recalls, inside the caller's transaction, checking every
 * reference against the register that transaction sees.
 *
 * A refusal leaves the rows already inserted in the caller's transaction, which is the caller's to roll back: this
 * writer never commits, and never opens a transaction of its own.
 *
 * @param writer the apply transaction
 * @param memories the imported recordings no row here already carries, in export order
 * @param recalls the imported recalls no row here already carries, in export order
 * @returns how many rows each table took, or `SUPERSEDES_REFUSED`, `CORRUPT_RECORDING` naming a recall whose
 *   recording is not its claim's, or `DATABASE_FAILED`
 */
export async function appendImportedKnowledge({
  writer,
  memories,
  recalls,
}: {
  writer: StoreWriter;
  memories: readonly RestoredRecording[];
  recalls: readonly RecallRecord[];
}): Promise<Result<KnowledgeImportWriteOutcome, KnowledgeError>> {
  try {
    const memoriesWritten = await insertMemories({ memories, writer });
    const superseded = await supersessionsHold({ memories, writer });
    if (superseded.isErr()) {
      return err(superseded.error);
    }
    const referenced = await recallReferencesHold({ recalls, writer });
    if (referenced.isErr()) {
      return err(referenced.error);
    }
    const recallsWritten = await insertRecalls({ recalls, writer });
    return ok({ memories: memoriesWritten, recalls: recallsWritten });
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "append the imported memories and recalls" }));
  }
}
