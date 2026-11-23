/**
 * Appending ONE recording or ONE recall to the memories tables, each checked against the claim's latest
 * recording first — the single-row writers, beside `./memoryStore.ts`, which keeps the recall query, the
 * whole-table export and import, and the lesson and trace readers.
 *
 * Every function here takes an already-open {@link StoreClient} rather than opening one, for the reason
 * `./memoryStore.ts`'s overview gives, and a database failure is the typed `DATABASE_FAILED`, never an empty
 * result. This module imports nothing from `./memoryStore.ts`, type imports included, and that module imports
 * nothing from here: the two share no edge.
 */
import { desc, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreReader, StoreWriter } from "../store/client.js";
import { type MemoryRecordingRow, memoriesTable } from "../store/schema/memories.js";
import { type MemoryRecallRow, memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import type { MemoryRecording } from "./memory.js";
import { type RecallFields, recordingOf, regradeFor, regradeRecording } from "./recallAccounting.js";
import { supersessionCheck } from "./supersession.js";

/**
 * Append one recording.
 *
 * Append, never upsert: two recordings of the same claim are the consolidation signal
 * (`../store/schema/memories.ts`), so a writer that collapsed them would delete the feature.
 *
 * A recording that names a claim to retire is checked against the table FIRST, here rather than at each
 * verb, so no writer can retire a claim nobody recorded or one of another kind — the pure readers see one
 * kind at a time, so a cross-kind retirement would be invisible to them.
 *
 * @param client an open connection
 * @param row the validated recording
 * @returns the row as the database stored it, or the typed failure
 */
export async function recordMemory({
  client,
  row,
}: {
  client: StoreClient;
  row: MemoryRecording;
}): Promise<Result<MemoryRecordingRow, KnowledgeError>> {
  if (row.supersedes !== null) {
    const target = await latestRecordingOf({ client, memoryId: row.supersedes });
    const checked = supersessionCheck({ row, target });
    if (checked.isErr()) {
      return err(checked.error);
    }
  }
  try {
    const inserted = await client.db.insert(memoriesTable).values(row).returning();
    const first = inserted[0];
    if (first === undefined) {
      return err(KnowledgeErrors.databaseFailed({ cause: "insert returned no row", doing: "record the memory" }));
    }
    return ok(first);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "record the memory" }));
  }
}

/**
 * What one accounted recall wrote: the ledger row, and the regrading recording when the outcome earned one.
 */
export interface RecallWrite {
  /** The accounting row, always written. */
  readonly recall: MemoryRecallRow;
  /** The recording this recall regraded the claim to, or null when the verdict did not move. */
  readonly regraded: MemoryRecordingRow | null;
}

/**
 * Account for one recall, and regrade the claim in the SAME transaction when the outcome earned it.
 *
 * One transaction, and that is the correctness property rather than tidiness: a ledger row saying a memory
 * broke, beside a register that still calls the claim confirmed, describes a check nobody can act on. Both
 * land or neither does.
 *
 * The claim's latest recording is read FIRST and the regrading recording is built from it
 * (`./recallAccounting.ts`), so the claim text is carried byte for byte and the claim id cannot drift.
 *
 * @param client an open connection
 * @param fields the validated recall
 * @param recallId this ledger row's uuid, passed in so the caller owns id generation
 * @param regradeRecordingId the uuid a regrading recording would take, minted whether or not it is used
 * @param recordedAt the instant to stamp both rows with
 * @returns what was written, or the typed failure
 */
export async function recordRecall({
  client,
  fields,
  recallId,
  regradeRecordingId,
  recordedAt,
}: {
  client: StoreClient;
  fields: RecallFields;
  recallId: string;
  regradeRecordingId: string;
  recordedAt: Date;
}): Promise<Result<RecallWrite, KnowledgeError>> {
  const latest = await latestRecordingOf({ client, memoryId: fields.memoryId });
  if (latest.isErr()) {
    return err(latest.error);
  }
  const regrade = regradeFor({
    currentVerdict: latest.value.verdict,
    outcome: fields.outcome,
    verdict: fields.verdict,
  });
  let recording: MemoryRecording | null = null;
  if (regrade.kind === "record") {
    recording = regradeRecording({
      evidence: fields.evidence,
      latest: recordingOf({ row: latest.value }),
      recordedAt,
      recordingId: regradeRecordingId,
      run: fields.run,
      verdict: regrade.verdict,
    });
  }
  try {
    return ok(
      await client.db.transaction((writer): Promise<RecallWrite> =>
        writeRecall({
          fields,
          readRecordingId: latest.value.recordingId,
          recallId,
          recordedAt,
          recording,
          writer,
        }),
      ),
    );
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: `account for a recall of ${fields.memoryId}` }));
  }
}

/**
 * The claim's current recording, or the typed refusal when the register has never recorded that claim.
 *
 * @param client an open connection, or a transaction, which reads what it has already written
 * @param memoryId the claim id
 * @returns the latest recording, or the failure
 */
export async function latestRecordingOf({
  client,
  memoryId,
}: {
  client: StoreReader;
  memoryId: string;
}): Promise<Result<MemoryRecordingRow, KnowledgeError>> {
  let rows: readonly MemoryRecordingRow[];
  try {
    rows = await client.db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.id, memoryId))
      .orderBy(desc(memoriesTable.recordedAt), desc(memoriesTable.seq))
      .limit(1);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: `read the latest recording of ${memoryId}` }));
  }
  const first = rows[0];
  if (first === undefined) {
    return err(KnowledgeErrors.memoryUnknown({ memoryId }));
  }
  return ok(first);
}

/**
 * Both inserts, inside the caller's transaction. Throws rather than returning, so the transaction rolls back.
 *
 * @param writer the open transaction
 * @param fields the validated recall
 * @param readRecordingId the recording the session actually read
 * @param recallId this ledger row's uuid
 * @param recordedAt the instant both rows carry
 * @param recording the regrading recording, or null when the verdict did not move
 * @returns what was written
 */
async function writeRecall({
  writer,
  fields,
  readRecordingId,
  recallId,
  recordedAt,
  recording,
}: {
  writer: StoreWriter;
  fields: RecallFields;
  readRecordingId: string;
  recallId: string;
  recordedAt: Date;
  recording: MemoryRecording | null;
}): Promise<RecallWrite> {
  const written = await writer
    .insert(memoryRecallsTable)
    .values({
      evidence: fields.evidence,
      memoryId: fields.memoryId,
      outcome: fields.outcome,
      recallId,
      recordedAt,
      recordingId: readRecordingId,
      run: fields.run,
    })
    .returning();
  const row = written[0];
  if (row === undefined) {
    throw new Error("the recall insert returned no row");
  }
  if (recording === null) {
    return { recall: row, regraded: null };
  }
  const regraded = await writer.insert(memoriesTable).values(recording).returning();
  const first = regraded[0];
  if (first === undefined) {
    throw new Error("the regrade insert returned no row");
  }
  return { recall: row, regraded: first };
}
