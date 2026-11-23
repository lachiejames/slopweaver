/**
 * Rewriting stored recordings in place — the two whole-table maintenance writers, beside `./memoryStore.ts`
 * which appends. A recording is otherwise never updated; each function here exists for one one-off repair
 * (an import-key scheme change, a domain fold) and runs as ONE transaction, because a half-applied rewrite
 * leaves a register neither the old nor the new reader can reason about.
 */
import { eq, isNotNull } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";
import type { StoreClient } from "../store/client.js";
import { memoriesTable } from "../store/schema/memories.js";
import { memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import type { DomainMigrationPlan } from "./domainMigration.js";
import { type KnowledgeError, KnowledgeErrors } from "./errors.js";

/**
 * Every imported recording's key and claim, oldest first — what a rekey verifies against its source file.
 *
 * Only the three columns a rekey reads, rather than whole rows: the plan compares a claim and rewrites a
 * key, and pulling the evidence text of a thousand rows to do that is a read nobody asked for.
 *
 * @param client an open connection
 * @returns one entry per row carrying an import key, or the typed failure
 */
export async function readImportedKeys({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly { recordingId: string; importKey: string; claim: string }[], KnowledgeError>> {
  try {
    const rows = await client.db
      .select({
        claim: memoriesTable.claim,
        importKey: memoriesTable.importKey,
        recordingId: memoriesTable.recordingId,
      })
      .from(memoriesTable)
      .where(isNotNull(memoriesTable.importKey))
      .orderBy(memoriesTable.seq);
    return ok(rows.map((row) => ({ claim: row.claim, importKey: row.importKey!, recordingId: row.recordingId })));
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "read the stored import keys" }));
  }
}

/**
 * Rewrite stored import keys onto the current scheme, all in one transaction.
 *
 * All or nothing: a half-rekeyed table is one where some rows would match a later apply and some would not,
 * which is the duplicate-half-the-register state this exists to prevent rather than a smaller version of it.
 *
 * @param client an open connection
 * @param rekeys the verified rewrites
 * @returns how many rows were rewritten, or the typed failure
 */
export async function rekeyImports({
  client,
  rekeys,
}: {
  client: StoreClient;
  rekeys: readonly { recordingId: string; to: string }[];
}): Promise<Result<number, KnowledgeError>> {
  if (rekeys.length === 0) {
    return ok(0);
  }
  try {
    const written = await client.db.transaction(async (writer): Promise<number> => {
      for (const rekey of rekeys) {
        await writer
          .update(memoriesTable)
          .set({ importKey: rekey.to })
          .where(eq(memoriesTable.recordingId, rekey.recordingId));
      }
      return rekeys.length;
    });
    return ok(written);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: `rekey ${String(rekeys.length)} recording(s)` }));
  }
}

/**
 * Apply a domain fold, all in one transaction: every recording's domain, claim id and `supersedes`, then
 * every recall's claim id.
 *
 * All or nothing for the reason {@link rekeyImports} gives: a recording moved to its new id while its recalls
 * still name the old one would lose its accounting, which is the data this whole register exists to keep.
 *
 * @param client an open connection
 * @param plan the fold `./domainMigration.ts` planned, already checked for unmapped domains
 * @returns how many recordings and recalls were rewritten, or the typed failure
 */
export async function applyDomainMigration({
  client,
  plan,
}: {
  client: StoreClient;
  plan: DomainMigrationPlan;
}): Promise<Result<{ recordings: number; recalls: number }, KnowledgeError>> {
  try {
    const written = await client.db.transaction(async (writer): Promise<{ recordings: number; recalls: number }> => {
      for (const rewrite of plan.rewrites) {
        await writer
          .update(memoriesTable)
          .set({ domain: rewrite.domain, id: rewrite.id, supersedes: rewrite.supersedes })
          .where(eq(memoriesTable.recordingId, rewrite.recordingId));
      }
      let recalls = 0;
      for (const moved of plan.idMap) {
        const updated = await writer
          .update(memoryRecallsTable)
          .set({ memoryId: moved.to })
          .where(eq(memoryRecallsTable.memoryId, moved.from))
          .returning({ recallId: memoryRecallsTable.recallId });
        recalls += updated.length;
      }
      return { recalls, recordings: plan.rewrites.length };
    });
    return ok(written);
  } catch (cause) {
    return err(
      KnowledgeErrors.databaseFailed({
        cause,
        doing: `fold ${String(plan.rewrites.length)} recording(s) onto canonical domains`,
      }),
    );
  }
}
