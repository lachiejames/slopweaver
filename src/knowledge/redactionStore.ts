/**
 * Knowledge redaction's effectful half — the scan and the in-place rewrite of rows already stored. The decisions
 * are all `./redaction.ts`'s; this file only reads, archives, writes and re-reads.
 *
 * The rewrite is ONE transaction holding both tables locked against writers for its whole length, because a
 * recording written between the read and the update would land unredacted beside rows reported clean, and a
 * claim moved while a concurrent recall still named its old id would lose that recall's accounting. Inside it:
 * read every row, plan, archive the pre-rewrite rows, update in place by physical id, then re-read and re-scan —
 * a residue rolls the whole thing back. Nothing is ever deleted; the archive is the old rows, kept.
 */
import { eq, sql } from "drizzle-orm";

import type { IdentifierScanner } from "../hygiene/identifierScan.js";
import type { ReplacementRule } from "../hygiene/replacementMap.js";
import { err, ok, type Result } from "../lib/result.js";
import type { StoreClient, StoreWriter } from "../store/client.js";
import { type MemoryRecordingRow, memoriesTable } from "../store/schema/memories.js";
import { type MemoryRecallRow, memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { readAllMemories, readAllRecalls } from "./memoryStore.js";
import { type KnowledgeRedactionPlan, planKnowledgeRedaction } from "./redaction.js";
import { type KnowledgeRedactionError, KnowledgeRedactionErrors } from "./redactionErrors.js";
import { KNOWLEDGE_REFERENCE_FIELDS } from "./redactionFields.js";
import { type KnowledgeReferenceScan, scanKnowledgeRows } from "./redactionScan.js";

/** What an in-place redaction did. */
export interface StoredRedactionOutcome {
  readonly changedMemories: number;
  readonly changedRecalls: number;
  readonly movedClaims: number;
  readonly merges: number;
  /** Where the pre-rewrite rows were kept, or `undefined` when nothing needed rewriting. */
  readonly archive: string | undefined;
  /** The scan of the store as the transaction left it — zero by construction, or the rewrite rolled back. */
  readonly after: KnowledgeReferenceScan;
}

/** Where the pre-rewrite rows go, and the writer that puts them there, throwing when it cannot. */
export interface RedactionArchive {
  readonly path: string;
  readonly write: (args: { memories: readonly MemoryRecordingRow[]; recalls: readonly MemoryRecallRow[] }) => void;
}

/** A typed refusal raised inside the transaction, so drizzle rolls back and the outer catch can return it. */
class RedactionAbort extends Error {
  readonly refusal: KnowledgeRedactionError;
  constructor({ refusal }: { refusal: KnowledgeRedactionError }) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

/** Update, by physical id, every row the plan changed; a row it returned as the input object itself is skipped. */
async function updateChangedRows({
  writer,
  plan,
  memories,
  recalls,
}: {
  writer: StoreWriter;
  plan: KnowledgeRedactionPlan<MemoryRecordingRow, MemoryRecallRow>;
  memories: readonly MemoryRecordingRow[];
  recalls: readonly MemoryRecallRow[];
}): Promise<void> {
  for (const [index, row] of plan.memories.entries()) {
    if (row === memories[index]) {
      continue;
    }
    await writer
      .update(memoriesTable)
      .set({
        behaviourChange: row.behaviourChange,
        caveat: row.caveat,
        claim: row.claim,
        domain: row.domain,
        evidence: row.evidence,
        id: row.id,
        learner: row.learner,
        question: row.question,
        repro: row.repro,
        retrievalCue: row.retrievalCue,
        run: row.run,
        supersedes: row.supersedes,
      })
      .where(eq(memoriesTable.recordingId, row.recordingId));
  }
  for (const [index, row] of plan.recalls.entries()) {
    if (row === recalls[index]) {
      continue;
    }
    await writer
      .update(memoryRecallsTable)
      .set({ evidence: row.evidence, memoryId: row.memoryId, run: row.run })
      .where(eq(memoryRecallsTable.recallId, row.recallId));
  }
}

/** Re-read both tables inside the transaction and throw, so it rolls back, on any residue the rewrite left. */
async function rescanOrAbort({
  writer,
  scanner,
}: {
  writer: StoreWriter;
  scanner: IdentifierScanner;
}): Promise<KnowledgeReferenceScan> {
  const after = scanKnowledgeRows({
    memories: await writer.select().from(memoriesTable),
    recalls: await writer.select().from(memoryRecallsTable),
    scanner,
  });
  const residue = KNOWLEDGE_REFERENCE_FIELDS.find((field) => after.byField[field] > 0);
  if (residue !== undefined) {
    throw new RedactionAbort({
      refusal: KnowledgeRedactionErrors.incomplete({ field: residue, rows: after.byField[residue] }),
    });
  }
  return after;
}

/**
 * Scan every stored recording and recall for a forbidden identifier.
 *
 * @param client an open connection
 * @param scanner a scanner bound to the committed rules
 * @returns the counts by kind and by field, or the typed read failure
 */
export async function scanStoredKnowledge({
  client,
  scanner,
}: {
  client: StoreClient;
  scanner: IdentifierScanner;
}): Promise<Result<KnowledgeReferenceScan, KnowledgeError>> {
  const memories = await readAllMemories({ client });
  if (memories.isErr()) {
    return err(memories.error);
  }
  const recalls = await readAllRecalls({ client });
  if (recalls.isErr()) {
    return err(recalls.error);
  }
  return ok(scanKnowledgeRows({ memories: memories.value, recalls: recalls.value, scanner }));
}

/**
 * Redact every stored row in place, in one locked transaction, archiving the old rows first.
 *
 * @param client an open connection
 * @param scanner a scanner bound to the committed rules
 * @param map the install's ordered replacement rules, empty when it has none
 * @param archive the writer the pre-rewrite rows go through, called inside the transaction
 * @returns what changed and the zero scan it left, or the typed refusal — in which case nothing was written
 */
export async function applyStoredKnowledgeRedaction({
  client,
  scanner,
  map,
  archive,
}: {
  client: StoreClient;
  scanner: IdentifierScanner;
  map: readonly ReplacementRule[];
  archive: RedactionArchive;
}): Promise<Result<StoredRedactionOutcome, KnowledgeRedactionError | KnowledgeError>> {
  try {
    const outcome = await client.db.transaction(async (writer): Promise<StoredRedactionOutcome> => {
      await writer.execute(sql`lock table memories, memory_recalls in share row exclusive mode`);
      const memories = await writer.select().from(memoriesTable).orderBy(memoriesTable.recordedAt, memoriesTable.seq);
      const recalls = await writer.select().from(memoryRecallsTable).orderBy(memoryRecallsTable.seq);
      const planned = planKnowledgeRedaction({ map, memories, recalls, scanner });
      if (planned.isErr()) {
        throw new RedactionAbort({ refusal: planned.error });
      }
      const plan = planned.value;
      if (plan.changedMemories === 0 && plan.changedRecalls === 0) {
        return {
          after: scanKnowledgeRows({ memories, recalls, scanner }),
          archive: undefined,
          changedMemories: 0,
          changedRecalls: 0,
          merges: 0,
          movedClaims: 0,
        };
      }
      try {
        archive.write({ memories, recalls });
      } catch (cause) {
        throw new RedactionAbort({ refusal: KnowledgeRedactionErrors.archiveFailed({ cause, path: archive.path }) });
      }
      await updateChangedRows({ memories, plan, recalls, writer });
      return {
        after: await rescanOrAbort({ scanner, writer }),
        archive: archive.path,
        changedMemories: plan.changedMemories,
        changedRecalls: plan.changedRecalls,
        merges: plan.merges,
        movedClaims: plan.idMap.length,
      };
    });
    return ok(outcome);
  } catch (cause) {
    if (cause instanceof RedactionAbort) {
      return err(cause.refusal);
    }
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "redact the stored register in place" }));
  }
}
