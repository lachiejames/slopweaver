/**
 * Writing an applied store import's owner directives and corrections inside the caller's transaction.
 *
 * Each imported version is a `store-import` row naming the question that let it in, which the store's
 * `owner_*_import_origin` CHECK demands and no other writer may claim. A version the owner left inactive is inserted
 * inactive and steers nothing; one that takes over a live version first retires that version, the same retire-then-insert
 * `./ownerDirectiveRows.ts` performs for a memory event, so the partial unique index on the active version never sees
 * two at once.
 *
 * A retirement names its target by id and active state alone, so the version it retires is whichever one is active in
 * the caller's transaction. That is the contract: the caller plans in that same transaction, holding both tables
 * locked, and derives `retiresCurrent` from that plan (store import, part 5-4, re-plans there before any write), so
 * the active version is the one the plan saw; a caller planning anywhere else breaks it. A retirement that finds no
 * active version to retire refuses rather than inserting beside nothing: the import was planned against a live
 * version, so its absence means the plan no longer describes the table. A version asking to
 * retire the live one while written inactive is refused before any statement: only `take-imported` retires, and it
 * writes the import active.
 */
import { and, eq } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreWriter } from "../store/client.js";
import { ownerCorrectionTable, ownerDirectiveTable } from "../store/schema/ownerJudgement.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";
import type { OwnerCorrection, OwnerDirective } from "./ownerDirective.js";
import { correctionRowOf, directiveRowOf, type JudgementInstructionState } from "./ownerJudgementRecords.js";

/** One imported version and what the owner's answer made of it. */
interface ImportedVersion<T> {
  readonly value: T;
  /** Whether it steers: `activate` and `take-imported` are active, `leave-inactive` is not. */
  readonly state: JudgementInstructionState;
  /** The import question whose answer admitted it. */
  readonly questionId: string;
  /** Whether a live active version of the same id retires first — `take-imported` only. */
  readonly retiresCurrent: boolean;
}

/** One imported directive version. */
export type ImportedDirectiveVersion = ImportedVersion<OwnerDirective>;

/** One imported correction version. */
export type ImportedCorrectionVersion = ImportedVersion<OwnerCorrection>;

/**
 * Turn a thrown driver error into this domain's store variant, by the driver's own reason: drizzle wraps it in a
 * "Failed query" error whose message names the statement and not the key or CHECK it met.
 */
function writeFailure({ cause }: { cause: unknown }): OwnerDirectiveError {
  let innermost = cause;
  while (innermost instanceof Error && innermost.cause instanceof Error) {
    innermost = innermost.cause;
  }
  const reason = innermost instanceof Error ? innermost.message : String(innermost);
  return OwnerDirectiveErrors.storeUnavailable({ doing: "take an imported version", reason });
}

/** Retire one directive's active version, counting what retired. */
async function retireDirective({ writer, id }: { writer: StoreWriter; id: string }): Promise<number> {
  const retired = await writer
    .update(ownerDirectiveTable)
    .set({ state: "inactive" })
    .where(and(eq(ownerDirectiveTable.state, "active"), eq(ownerDirectiveTable.directiveId, id)))
    .returning({ rowId: ownerDirectiveTable.rowId });
  return retired.length;
}

/** Retire one correction's active version, counting what retired. */
async function retireCorrection({ writer, id }: { writer: StoreWriter; id: string }): Promise<number> {
  const retired = await writer
    .update(ownerCorrectionTable)
    .set({ state: "inactive" })
    .where(and(eq(ownerCorrectionTable.state, "active"), eq(ownerCorrectionTable.correctionId, id)))
    .returning({ rowId: ownerCorrectionTable.rowId });
  return retired.length;
}

/** Write every imported directive, each retirement before its insert; the count is every row written. */
async function writeDirectives({
  writer,
  directives,
}: {
  writer: StoreWriter;
  directives: readonly ImportedDirectiveVersion[];
}): Promise<Result<number, OwnerDirectiveError>> {
  let writes = 0;
  for (const version of directives) {
    if (version.retiresCurrent) {
      const retired = await retireDirective({ id: version.value.id, writer });
      if (retired === 0) {
        return err(OwnerDirectiveErrors.importTargetGone({ id: version.value.id, kind: "directive" }));
      }
      writes += retired;
    }
    const row = directiveRowOf({ directive: version.value, origin: "store-import", state: version.state });
    await writer.insert(ownerDirectiveTable).values({ ...row, importQuestionId: version.questionId });
    writes += 1;
  }
  return ok(writes);
}

/** Write every imported correction, each retirement before its insert; the count is every row written. */
async function writeCorrections({
  writer,
  corrections,
}: {
  writer: StoreWriter;
  corrections: readonly ImportedCorrectionVersion[];
}): Promise<Result<number, OwnerDirectiveError>> {
  let writes = 0;
  for (const version of corrections) {
    if (version.retiresCurrent) {
      const retired = await retireCorrection({ id: version.value.id, writer });
      if (retired === 0) {
        return err(OwnerDirectiveErrors.importTargetGone({ id: version.value.id, kind: "correction" }));
      }
      writes += retired;
    }
    const row = correctionRowOf({ correction: version.value, origin: "store-import", state: version.state });
    await writer.insert(ownerCorrectionTable).values({ ...row, importQuestionId: version.questionId });
    writes += 1;
  }
  return ok(writes);
}

/** The first version that would retire a live one while written inactive — a pair no answer produces — if any. */
function contradictoryAnswer({
  directives,
  corrections,
}: {
  directives: readonly ImportedDirectiveVersion[];
  corrections: readonly ImportedCorrectionVersion[];
}): OwnerDirectiveError | undefined {
  const directive = directives.find((version) => version.retiresCurrent && version.state !== "active");
  if (directive !== undefined) {
    return OwnerDirectiveErrors.importAnswerContradictory({ id: directive.value.id, kind: "directive" });
  }
  const correction = corrections.find((version) => version.retiresCurrent && version.state !== "active");
  if (correction !== undefined) {
    return OwnerDirectiveErrors.importAnswerContradictory({ id: correction.value.id, kind: "correction" });
  }
  return undefined;
}

/**
 * Write an applied import's directive and correction versions through the caller's transaction.
 *
 * @param writer the apply transaction, which already holds both tables locked and planned the versions within them
 * @param directives the imported directive versions, each with the state its answer gave it
 * @param corrections the imported correction versions, likewise
 * @returns how many rows were written, retirements included, or `OWNER_DIRECTIVE_IMPORT_ANSWER_CONTRADICTORY`, before
 *   any statement, when a version would retire a live one while written inactive, or
 *   `OWNER_DIRECTIVE_IMPORT_TARGET_GONE` when a version the import takes over is no longer active, or
 *   `OWNER_DIRECTIVE_STORE_UNAVAILABLE` when a statement failed
 */
export async function writeImportedOwnerJudgement({
  writer,
  directives,
  corrections,
}: {
  writer: StoreWriter;
  directives: readonly ImportedDirectiveVersion[];
  corrections: readonly ImportedCorrectionVersion[];
}): Promise<Result<number, OwnerDirectiveError>> {
  const contradiction = contradictoryAnswer({ corrections, directives });
  if (contradiction !== undefined) {
    return err(contradiction);
  }
  try {
    const directiveWrites = await writeDirectives({ directives, writer });
    if (directiveWrites.isErr()) {
      return directiveWrites;
    }
    const correctionWrites = await writeCorrections({ corrections, writer });
    if (correctionWrites.isErr()) {
      return correctionWrites;
    }
    return ok(directiveWrites.value + correctionWrites.value);
  } catch (cause) {
    return err(writeFailure({ cause }));
  }
}
