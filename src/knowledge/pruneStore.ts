/**
 * The store half of `slopweaver knowledge prune`: read what a prune archives, then apply it in one transaction.
 *
 * Kept apart from `./memoryStore.ts`, whose every other write only appends. These two are the register's one
 * delete path, and the plan they execute is validated whole by `./prune.ts` before either runs.
 */
import { inArray } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";
import type { StoreClient } from "../store/client.js";
import { type MemoryRecordingRow, memoriesTable } from "../store/schema/memories.js";
import { type MemoryRecallRow, memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import type { MemoryRecording } from "./memory.js";

/** What one applied prune removed and wrote. */
export interface PruneWrite {
  /** Recordings deleted, across every retired claim. */
  readonly recordingsRemoved: number;
  /** Recall-ledger rows deleted with them — accounting for a claim that no longer exists. */
  readonly recallsRemoved: number;
  /** Replacement recordings written. */
  readonly recordingsWritten: number;
}

/**
 * Every recording and every recall of a set of claims — what a prune archives BEFORE it deletes anything.
 *
 * @param client an open connection
 * @param ids the claim ids about to be retired
 * @returns both sets, oldest first, or the typed failure
 */
export async function readClaimsForArchive({
  client,
  ids,
}: {
  client: StoreClient;
  ids: readonly string[];
}): Promise<
  Result<{ recordings: readonly MemoryRecordingRow[]; recalls: readonly MemoryRecallRow[] }, KnowledgeError>
> {
  if (ids.length === 0) {
    return ok({ recalls: [], recordings: [] });
  }
  try {
    const recordings = await client.db
      .select()
      .from(memoriesTable)
      .where(inArray(memoriesTable.id, [...ids]))
      .orderBy(memoriesTable.seq);
    const recalls = await client.db
      .select()
      .from(memoryRecallsTable)
      .where(inArray(memoryRecallsTable.memoryId, [...ids]))
      .orderBy(memoryRecallsTable.seq);
    return ok({ recalls, recordings });
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: `read ${String(ids.length)} claim(s) to archive` }));
  }
}

/**
 * Apply a prune in ONE transaction: write every replacement, then delete exactly the recordings and recalls
 * the archive holds.
 *
 * All or nothing, for the reason `importMemories` gives. The replacements are written FIRST so a claim whose
 * rewrite kept its id is never absent from the table, even inside the transaction. Deletion is by the
 * ARCHIVED physical ids, never by claim id: a recording another session writes between the archive read and
 * this transaction is a new observation nobody archived, so it stays.
 *
 * @param client an open connection
 * @param inserts the replacement recordings
 * @param recordingIds the archived recordings that leave the table
 * @param recallIds the archived recalls that leave the table
 * @returns what was removed and written, or the typed failure
 */
export async function applyPrune({
  client,
  inserts,
  recallIds,
  recordingIds,
}: {
  client: StoreClient;
  inserts: readonly MemoryRecording[];
  recallIds: readonly string[];
  recordingIds: readonly string[];
}): Promise<Result<PruneWrite, KnowledgeError>> {
  try {
    const written = await client.db.transaction(async (writer): Promise<PruneWrite> => {
      const inserted =
        inserts.length === 0
          ? []
          : await writer
              .insert(memoriesTable)
              .values([...inserts])
              .returning({ id: memoriesTable.recordingId });
      const recalls =
        recallIds.length === 0
          ? []
          : await writer
              .delete(memoryRecallsTable)
              .where(inArray(memoryRecallsTable.recallId, [...recallIds]))
              .returning({ id: memoryRecallsTable.recallId });
      const recordings =
        recordingIds.length === 0
          ? []
          : await writer
              .delete(memoriesTable)
              .where(inArray(memoriesTable.recordingId, [...recordingIds]))
              .returning({ id: memoriesTable.recordingId });
      return {
        recallsRemoved: recalls.length,
        recordingsRemoved: recordings.length,
        recordingsWritten: inserted.length,
      };
    });
    return ok(written);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: `prune ${String(recordingIds.length)} recording(s)` }));
  }
}
