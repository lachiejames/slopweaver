/**
 * Applying a staged import: every row its answers admit written into the live registers in ONE transaction, with a
 * receipt last, or none of the batch at all.
 *
 * First the batch's receipt is looked for, in a short read of its own: a batch already applied is reported so, and
 * nothing else runs, so a re-run after a commit of unknown outcome finds the receipt whatever the home files now hold.
 * Before the transaction, every register's one-time import of its legacy home file runs, as before an export, so the
 * live side compared is the whole register; that runs in its own transactions and stands whatever the apply then does.
 * The residue, stated: a refused apply can leave that one-time migration committed, before any apply lock is taken.
 * It is the register's own, marker-guarded and run by an export too, and it writes only what the home file holds, never
 * from the batch. A home-file row may equal one the batch carries; it then stands as the home's, and the batch, re-planned
 * over it below, may refuse as stale. What the batch itself writes is written only inside the transaction below, so a
 * refusal leaves none of it.
 * Inside it, in this order: the real tables only; the batch row locked, so two applies of one batch serialise and the
 * second finds the first's receipt; every staging table and live register locked, so no guard can be disabled or
 * dropped and no answer can change until commit (a guard's function body is database code, trusted as below); every guard present and enabled ALWAYS; a replica-mode session refused; then the batch
 * planned again over the live store as this transaction sees it (`./importApplyRead.ts`). A session that owns the
 * tables can still drop a guard it is allowed to, but not while these locks stand. The rows it writes are written
 * register by register in dependency order, each through its own domain's writer in this transaction (store import,
 * part 5-3); then every check deferred to COMMIT is made to fire (`set constraints all immediate`), so a deferred
 * trigger acts before the read and not after it; then the receipt, the last write, its own checks immediate too, which
 * must read back as written; then the store is read back (`writtenAsDecided`) after every write, so an imported row a
 * trigger, rule or policy dropped without an error, or rewrote in a column the import compares, by the time of that
 * read — a trigger on the receipt's own insert included — refuses the batch. Past those reads, code installed in the
 * database is trusted, as it is for every writer: what the apply derives beside the
 * imported rows (a live row retired or withdrawn, a journal position, a revision), an id the store assigns, the content
 * of an instruction written inactive, a function a trigger runs and any other table are not checked. So a trigger
 * function that defers a check again, or queues work for COMMIT itself, is trusted with the rest: what runs at COMMIT
 * runs after every read a transaction can make. So is database code a read itself runs — a row-security policy or a
 * function it calls — that writes as it is read: the read-back is a set of reads, and code that changes the store
 * from inside one of them is past what any read can check. Every read before the writes, the receipt's first among
 * them, trusts the store's row-security policies to be the migrations' own: a row one hides from the store's role
 * reads as absent, a receipt included, as no read can tell a hidden row from a missing one. A failure anywhere
 * in the transaction rolls the whole of it back, the receipt included.
 * A COMMIT that goes unanswered, or is answered with a code that does not say it rolled back, is the one exception: it
 * may have stood, so it is reported as unknown, never as none of the batch written; running the apply again finds the
 * receipt if it stood, and otherwise tries the batch again. A body that found the receipt wrote none of the batch: that
 * receipt was committed by another transaction (a concurrent apply's, perhaps after this call began) and only read by
 * this one, so it stands however this COMMIT ends, and the apply reports the batch already applied. The home-file
 * migration above is not the batch, and is never counted in `writes`: it may commit in any call that did not find the
 * receipt first, that one included.
 */
import { and, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import { writeImportedOwnerJudgement } from "../../judgement/ownerJudgementImport.js";
import { appendImportedKnowledge } from "../../knowledge/importAppend.js";
import { writeImportedStandingAsks } from "../../profile/standingAskImportWrite.js";
import { isStandingAskInstant } from "../../profile/standingAsks.js";
import { appendImportedSteerMeasurements } from "../../profile/steerMeasurementImport.js";
import type { StoreClient, StoreWriter } from "../client.js";
import { writeImportedOwnerProfile, writeImportedVoiceCohort } from "../profile/importWrite.js";
import { storeImportApplicationTable } from "../schema/importStaging.js";

import { ensureRegistersImported } from "./bundleWrite.js";
import type { ImportEffects } from "./importApplyEffects.js";
import { type AppendOnlyDifference, type StoreImportApplyError, StoreImportApplyErrors } from "./importApplyErrors.js";
import { settleThrownApply } from "./importApplyFailure.js";
import { decided, lockedBatch, lockRegisters, lockStaging } from "./importApplyRead.js";
import { writtenAsDecided } from "./importApplyReadBack.js";
import { applyGuardsInstalled, realTablesOnly } from "./importSession.js";

/** What an apply did: wrote the batch now, or found it already applied. */
export type ApplyStagedImportOutcome =
  | {
      readonly outcome: "applied";
      readonly batchId: string;
      readonly planDigest: string;
      /** Every staged row, written or not. */
      readonly items: number;
      /** Every row of the batch written, the receipt included; never the home-file migration's. */
      readonly writes: number;
      readonly appendOnlyDifferences: readonly AppendOnlyDifference[];
      readonly openAlignmentQuestionIds: readonly string[];
    }
  | {
      readonly outcome: "already-applied";
      readonly batchId: string;
      readonly planDigest: string;
      /** No row of the batch written by this call; the home-file migration, as for every apply, is not counted. */
      readonly writes: 0;
      /** The write count the batch's receipt records, believed as found, never re-counted from the rows. */
      readonly receiptWrites: number;
    };

/** Thrown only to roll the transaction back on a typed refusal, and caught at its boundary. */
class ApplyRollback extends Error {
  readonly refusal: StoreImportApplyError;

  constructor({ refusal }: { refusal: StoreImportApplyError }) {
    super(refusal.message);
    this.refusal = refusal;
  }
}

/** A refusal raised so the transaction rolls back. */
function rollBack({ refusal }: { refusal: StoreImportApplyError }): never {
  throw new ApplyRollback({ refusal });
}

/** One register's write and its count, or the apply's refusal naming the register. */
async function counted({
  batchId,
  register,
  write,
}: {
  batchId: string;
  register: string;
  write: () => Promise<Result<number, { readonly message: string }>>;
}): Promise<number> {
  const written = await write();
  if (written.isErr()) {
    return rollBack({
      refusal: StoreImportApplyErrors.applicationFailed({ batchId, register, why: written.error.message }),
    });
  }
  return written.value;
}

/** Write every effect, register by register in dependency order, and count every row written. */
async function writeEffects({
  writer,
  batchId,
  effects,
  nowIso,
}: {
  writer: StoreWriter;
  batchId: string;
  effects: ImportEffects;
  nowIso: string;
}): Promise<number> {
  const { profile } = effects;
  let writes = 0;
  if (profile !== null) {
    // The writer returns the revision it stored; the one row it inserted or updated is what is counted.
    writes += await counted({
      batchId,
      register: "the owner profile",
      write: async () => (await writeImportedOwnerProfile({ profile, writer })).map(() => 1),
    });
  }
  for (const cohort of effects.voice) {
    writes += await counted({
      batchId,
      register: "the voice register",
      write: () => writeImportedVoiceCohort({ cohort, writer }),
    });
  }
  writes += await counted({
    batchId,
    register: "the knowledge register",
    write: async () =>
      (await appendImportedKnowledge({ memories: effects.memories, recalls: effects.recalls, writer })).map(
        (outcome) => outcome.memories + outcome.recalls,
      ),
  });
  writes += await counted({
    batchId,
    register: "the owner directives and corrections",
    write: () =>
      writeImportedOwnerJudgement({ corrections: effects.corrections, directives: effects.directives, writer }),
  });
  writes += await counted({
    batchId,
    register: "the standing asks",
    write: () => writeImportedStandingAsks({ versions: effects.standingAsks, withdrawnAtIso: nowIso, writer }),
  });
  writes += await counted({
    batchId,
    register: "the steer measurements",
    write: () => appendImportedSteerMeasurements({ measurements: effects.steerMeasurements, writer }),
  });
  return writes;
}

/**
 * The batch's receipt, when it has one: already applied when the receipt names the batch's own plan, and refused when
 * it names another, which only a store missing the receipt's foreign key can hold.
 */
async function priorReceipt({
  writer,
  batchId,
  planDigest,
}: {
  writer: StoreWriter;
  batchId: string;
  planDigest: string;
}): Promise<ApplyStagedImportOutcome | undefined> {
  const [receipt] = await writer
    .select({ planDigest: storeImportApplicationTable.planDigest, writeCount: storeImportApplicationTable.writeCount })
    .from(storeImportApplicationTable)
    .where(eq(storeImportApplicationTable.batchId, batchId));
  if (receipt === undefined) {
    return undefined;
  }
  if (receipt.planDigest !== planDigest) {
    const why = `its receipt names plan ${receipt.planDigest}, not the batch's ${planDigest}, so what applied was another plan`;
    return rollBack({ refusal: StoreImportApplyErrors.applicationFailed({ batchId, register: "the receipt", why }) });
  }
  return { batchId, receiptWrites: receipt.writeCount, outcome: "already-applied", planDigest, writes: 0 };
}

/**
 * The batch's receipt, read in its own short transaction BEFORE the home-file migration, so a batch that already
 * applied — a re-run after a commit of unknown outcome among them — reports so even where that migration would now
 * refuse. The batch row is locked, so an apply still running is waited for and its receipt seen. The transaction that
 * writes reads the receipt again, for an apply that commits between the two. What the read found is set on `prior`
 * as the body returns, so a COMMIT of this read that then throws still reports a receipt it found.
 */
async function receiptBeforeMigration({
  client,
  batchId,
  prior,
}: {
  client: StoreClient;
  batchId: string;
  prior: { found?: ApplyStagedImportOutcome };
}): Promise<void> {
  await client.db.transaction(async (tx) => {
    await realTablesOnly({ writer: tx });
    const batch = await lockedBatch({ batchId, writer: tx });
    if (batch === undefined) {
      return;
    }
    const found = await priorReceipt({ batchId, planDigest: batch.planDigest, writer: tx });
    if (found !== undefined) {
      prior.found = found;
    }
  });
}

/** The batch's receipt written, and read back exactly as written, or the whole apply rolled back. */
async function recordReceipt({
  writer,
  batchId,
  planDigest,
  writes,
}: {
  writer: StoreWriter;
  batchId: string;
  planDigest: string;
  writes: number;
}): Promise<void> {
  await writer.insert(storeImportApplicationTable).values({ batchId, planDigest, writeCount: writes });
  const stored = await writer
    .select({ batchId: storeImportApplicationTable.batchId })
    .from(storeImportApplicationTable)
    .where(
      and(
        eq(storeImportApplicationTable.batchId, batchId),
        eq(storeImportApplicationTable.planDigest, planDigest),
        eq(storeImportApplicationTable.writeCount, writes),
      ),
    );
  if (stored.length !== 1) {
    const why = "the receipt does not read back as written, so a second apply would not find it";
    rollBack({ refusal: StoreImportApplyErrors.applicationFailed({ batchId, register: "the receipt", why }) });
  }
}

/** The apply inside its transaction: every guard, every lock, the fresh plan, the writes and the receipt. */
async function applyWithin({
  writer,
  batchId,
  stopOnConflict,
  nowIso,
}: {
  writer: StoreWriter;
  batchId: string;
  stopOnConflict: boolean;
  nowIso: string;
}): Promise<ApplyStagedImportOutcome> {
  await realTablesOnly({ writer });
  // Every lock before the guard check, so no guard checked here and no answer read below can change until commit.
  const batch = await lockedBatch({ batchId, writer });
  await lockStaging({ writer });
  await lockRegisters({ writer });
  const guarded = await applyGuardsInstalled({ writer });
  if (guarded.isErr()) {
    return rollBack({ refusal: guarded.error });
  }
  if (batch === undefined) {
    return rollBack({ refusal: StoreImportApplyErrors.batchNotStaged({ batchId }) });
  }
  const prior = await priorReceipt({ batchId, planDigest: batch.planDigest, writer });
  if (prior !== undefined) {
    return prior;
  }
  const [mode] = await writer.execute<{ role: string }>(
    sql`select current_setting('session_replication_role') as role`,
  );
  if (mode!.role === "replica") {
    return rollBack({ refusal: StoreImportApplyErrors.replicaSession({ batchId }) });
  }
  const plan = await decided({ batch, stopOnConflict, writer });
  if (plan.isErr()) {
    return rollBack({ refusal: plan.error });
  }
  const { application, effects } = plan.value;
  const writes = (await writeEffects({ batchId, effects, nowIso, writer })) + 1;
  // Every check deferred to COMMIT fires here instead, retroactively, so the read-back below sees what a deferred
  // trigger did to the rows just written, and the receipt's insert is checked immediately too.
  await writer.execute(sql`set constraints all immediate`);
  // The receipt is the last write, and the live rows are read back after it, so nothing its insert fires can change
  // a row once that row has been checked.
  await recordReceipt({ batchId, planDigest: batch.planDigest, writer, writes });
  const readBack = await writtenAsDecided({ application, writer, written: effects });
  if (readBack.isErr()) {
    return rollBack({ refusal: readBack.error });
  }
  return {
    appendOnlyDifferences: application.appendOnlyDifferences,
    batchId,
    items: [...application.staged.imported.values()].reduce((sum, entries) => sum + entries.length, 0),
    openAlignmentQuestionIds: application.openAlignmentQuestionIds,
    outcome: "applied",
    planDigest: batch.planDigest,
    writes,
  };
}

/**
 * Apply one staged import batch to the live store, whole or not at all.
 *
 * @param batchId the staged batch's id, as `store import --approve` printed it
 * @param client an open store connection, which this never closes
 * @param home the installation home whose legacy register files are imported once first, if they never were
 * @param stopOnConflict refuse the whole apply on any append-only difference, rather than keeping each live row
 * @param nowIso the instant a standing ask the import replaces is recorded withdrawn at
 * @returns what was applied, or that the batch already was, or why none of its rows was written: the instant is not one the
 *   standing-ask register admits (checked before anything is read, so readiness never passes a time a writer
 *   refuses), the batch is stale, a
 *   question is unanswered, a strict apply met a difference, a guard is missing, the session is a replica's, a
 *   register's write failed, a written row did not read back as written, or the receipt was not stored; or, the one
 *   outcome that is unknown rather than a refusal, that the body ran to its end and its COMMIT went unanswered or was
 *   answered with a code that does not say it rolled back (`./importApplyFailure.ts`)
 */
export async function applyStagedImport({
  batchId,
  client,
  home,
  stopOnConflict,
  nowIso,
}: {
  batchId: string;
  client: StoreClient;
  home: string;
  stopOnConflict: boolean;
  nowIso: string;
}): Promise<Result<ApplyStagedImportOutcome, StoreImportApplyError>> {
  if (!isStandingAskInstant({ value: nowIso })) {
    return err(StoreImportApplyErrors.instantInvalid({ batchId, nowIso }));
  }
  // A read that wrote nothing: a throw after it found the receipt still reports the batch applied, and any other
  // throw left nothing standing, so it is a failure, never a commit of unknown outcome.
  const prior: { found?: ApplyStagedImportOutcome } = {};
  try {
    await receiptBeforeMigration({ batchId, client, prior });
  } catch (cause) {
    if (cause instanceof ApplyRollback) {
      return err(cause.refusal);
    }
    return settleThrownApply({ batchId, cause, finished: prior.found });
  }
  if (prior.found !== undefined) {
    return ok(prior.found);
  }
  const ready = await ensureRegistersImported({ client, home });
  if (ready.isErr()) {
    return err(
      StoreImportApplyErrors.applicationFailed({ batchId, register: "the home files", why: ready.error.message }),
    );
  }
  // Set once the body returns, so a throw after it is known to have come from COMMIT.
  const body: { finished?: ApplyStagedImportOutcome } = {};
  try {
    return ok(
      await client.db.transaction(async (tx) => {
        body.finished = await applyWithin({ batchId, nowIso, stopOnConflict, writer: tx });
        return body.finished;
      }),
    );
  } catch (cause) {
    if (cause instanceof ApplyRollback) {
      return err(cause.refusal);
    }
    return settleThrownApply({ batchId, cause, finished: body.finished });
  }
}
