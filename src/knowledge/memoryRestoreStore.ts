/**
 * Putting an export back — ONE transaction across both tables, for a default restore and a merge alike.
 *
 * The restore this replaces ran the register and the ledger as two transactions and decoded the ledger only
 * after the register had committed, so a corrupt or failed recall file left a half-restored database: rows
 * with none of the accounting that ranks them. Here the caller decodes both files completely first, and this
 * transaction re-reads the live rows, plans against them (`./restoreMerge.ts`), inserts both tables and
 * advances both sequences — and a refusal or failure anywhere rolls back every ROW it wrote.
 *
 * **Rows, not sequences.** Postgres never rolls back `setval`: a transaction that advanced a sequence and then
 * failed leaves that sequence where the `setval` put it. That costs at most a gap in `seq`, never a lost row
 * or a collision, because every `setval` here targets its table's own highest `seq`, so the next value lands
 * above every row. It may also pull back a sequence a deleted top row had left ahead — harmless for the same
 * reason.
 *
 * **Both locks are asked for without waiting.** Two writers here touch both tables in opposite orders — a recall
 * regrade writes `memory_recalls` then `memories`, a domain rewrite the reverse — so no single order a restore
 * could wait in avoids a deadlock with both. A restore that never waits while holding a lock cannot be one half
 * of a cycle: when either table is busy it rolls back holding nothing, pauses and asks again, and only a writer
 * that outlasts every ask makes it refuse.
 */
import { sql } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";
import type { StoreClient, StoreWriter } from "../store/client.js";
import { memoriesTable } from "../store/schema/memories.js";
import { memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { planRestore, type RestoreInput, type RestoreMode, type RestorePlan } from "./restoreMerge.js";

/**
 * Rows per INSERT statement. A recording binds about two dozen parameters and Postgres caps one statement
 * at 65,535, so 500 rows sits far inside the cap while keeping a large export to a handful of statements.
 */
const INSERT_CHUNK = 500;

/** How many times a restore asks for both locks before it refuses. Each refused ask holds nothing. */
const LOCK_ATTEMPTS = 20;

/** The pause between two asks, so twenty of them outlast a writer for about five seconds. */
const LOCK_RETRY_MS = 250;

/** Postgres's `lock_not_available`, what a `NOWAIT` lock raises when another transaction holds a conflict. */
const LOCK_NOT_AVAILABLE = "55P03";

/** What a restore wrote and skipped, per table. */
export interface RestoreOutcome {
  readonly insertedMemories: number;
  readonly insertedRecalls: number;
  readonly skippedMemories: number;
  readonly skippedRecalls: number;
}

/**
 * A refusal raised INSIDE the transaction, so the transaction rolls back and the typed error survives the
 * throw. Never escapes this module: {@link restoreKnowledge} turns it back into the `Result` it carries.
 */
class RestoreRefusal extends Error {
  readonly refusal: KnowledgeError;

  constructor({ refusal }: { refusal: KnowledgeError }) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

/**
 * Whether a thrown value is Postgres refusing a `NOWAIT` lock, at any depth of `cause` — Drizzle wraps the
 * driver's error in its own.
 *
 * @param cause what the transaction threw
 * @returns true for `lock_not_available`
 */
function isLockNotAvailable({ cause }: { cause: unknown }): boolean {
  let at: unknown = cause;
  for (let depth = 0; depth < 5 && typeof at === "object" && at !== null; depth += 1) {
    if ("code" in at && at.code === LOCK_NOT_AVAILABLE) {
      return true;
    }
    at = "cause" in at ? at.cause : undefined;
  }
  return false;
}

/** Wait between two lock asks. */
const sleep = ({ ms }: { ms: number }): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Restore one decoded export, all or nothing for its rows.
 *
 * @param client an open connection
 * @param incoming the export's register and ledger, both decoded completely before this is called
 * @param mode `empty` for recovery into an empty database, `merge` for a checked merge into a live one
 * @param pause how to wait between two lock asks — a seam a test passes so it never waits on a real clock
 * @returns what was written and skipped, or the typed refusal or failure — either way, no row half-written
 */
export async function restoreKnowledge({
  client,
  incoming,
  mode,
  pause = sleep,
}: {
  client: StoreClient;
  incoming: RestoreInput;
  mode: RestoreMode;
  pause?: (wait: { ms: number }) => Promise<void>;
}): Promise<Result<RestoreOutcome, KnowledgeError>> {
  for (let attempt = 1; attempt <= LOCK_ATTEMPTS; attempt += 1) {
    try {
      return ok(await restoreOnce({ client, incoming, mode }));
    } catch (cause) {
      if (cause instanceof RestoreRefusal) {
        return err(cause.refusal);
      }
      if (!isLockNotAvailable({ cause })) {
        // A connection lost at COMMIT leaves the outcome unknown to any client — Postgres may have committed
        // every row. The display says so and names the recovery: a merge skips every row already held.
        return err(
          KnowledgeErrors.databaseFailed({
            cause,
            doing:
              `restore ${String(incoming.memories.length)} recording(s) and ${String(incoming.recalls.length)} ` +
              "recall(s) (a connection lost at commit may still have written them all; `--merge` again skips " +
              "every row already held)",
          }),
        );
      }
      if (attempt < LOCK_ATTEMPTS) {
        await pause({ ms: LOCK_RETRY_MS });
      }
    }
  }
  return err(KnowledgeErrors.restoreLockBusy({ attempts: LOCK_ATTEMPTS }));
}

/**
 * One attempt: lock both tables without waiting, read them, plan, write. Throws on any refusal or failure, so
 * its transaction rolls back.
 *
 * @param client an open connection
 * @param incoming the decoded export
 * @param mode the restore mode
 * @returns the counts
 */
async function restoreOnce({
  client,
  incoming,
  mode,
}: {
  client: StoreClient;
  incoming: RestoreInput;
  mode: RestoreMode;
}): Promise<RestoreOutcome> {
  return client.db.transaction(async (writer): Promise<RestoreOutcome> => {
    // Taken before the live read, so no other session can insert between the plan and the write: a recall
    // written concurrently would otherwise land on a seq the plan also hands out, and `memory_recalls.seq`
    // has no unique index to refuse it. SHARE ROW EXCLUSIVE blocks every INSERT and a second restore, and
    // still lets a reader through; NOWAIT refuses at once rather than queue (the file header says why).
    await writer.execute(sql`lock table memories, memory_recalls in share row exclusive mode nowait`);
    const live = {
      memories: await writer.select().from(memoriesTable),
      recalls: await writer.select().from(memoryRecallsTable),
    };
    const plan = planRestore({ incoming, live, mode });
    if (plan.isErr()) {
      throw new RestoreRefusal({ refusal: plan.error });
    }
    return writePlan({ plan: plan.value, writer });
  });
}

/**
 * Insert a plan's rows into both tables and advance both sequences, inside the caller's transaction.
 * Throws rather than returning a failure, so the transaction rolls back.
 *
 * @param writer the open transaction
 * @param plan the rows to insert
 * @returns the counts
 */
async function writePlan({ writer, plan }: { writer: StoreWriter; plan: RestorePlan }): Promise<RestoreOutcome> {
  let insertedMemories = 0;
  for (let at = 0; at < plan.memories.length; at += INSERT_CHUNK) {
    const chunk = plan.memories.slice(at, at + INSERT_CHUNK);
    const written = await writer
      .insert(memoriesTable)
      .values([...chunk])
      .returning({ id: memoriesTable.recordingId });
    insertedMemories += written.length;
  }
  let insertedRecalls = 0;
  for (let at = 0; at < plan.recalls.length; at += INSERT_CHUNK) {
    const chunk = plan.recalls.slice(at, at + INSERT_CHUNK);
    const written = await writer
      .insert(memoryRecallsTable)
      .values([...chunk])
      .returning({ id: memoryRecallsTable.recallId });
    insertedRecalls += written.length;
  }
  if (insertedMemories !== plan.memories.length || insertedRecalls !== plan.recalls.length) {
    throw new Error("a restore insert returned fewer rows than it was given");
  }
  // An insert naming `seq` does not move the sequence, so without this the next ordinary write would collide
  // with a restored row. Run for BOTH tables whether or not a table took rows: a merge that skips every
  // incoming recall still commits under the lock, and a sequence already behind its table's highest seq would
  // hand the first waiting write a seq a row holds — `memory_recalls.seq` has no unique index to refuse it.
  // `having` leaves an empty table's sequence where it is. A `setval` survives a later rollback (file header).
  await writer.execute(
    sql`select setval(pg_get_serial_sequence('memories', 'seq'), max(seq)) from memories having max(seq) is not null`,
  );
  await writer.execute(
    sql`select setval(pg_get_serial_sequence('memory_recalls', 'seq'), max(seq)) from memory_recalls having max(seq) is not null`,
  );
  return {
    insertedMemories,
    insertedRecalls,
    skippedMemories: plan.skippedMemories,
    skippedRecalls: plan.skippedRecalls,
  };
}
