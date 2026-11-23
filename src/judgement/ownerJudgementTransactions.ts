/**
 * What one owner-judgement transaction DOES, apart from the SQL it runs: the order a snapshot reads in, how a
 * memory event plans then applies, and which failure a throw becomes. `./ownerDirectiveRows.ts` hands each of
 * these its statements as plain functions, so the decisions are unit-tested here and the SQL is proven by the
 * opt-in `integration/ownerJudgementStore.test.ts`.
 */
import { err, ok, type Result } from "#lib/result.js";

import { isRecord } from "../lib/parsers.js";
import type { ImportMarker } from "../store/registerImport.js";

import { type OwnerDirectiveError, OwnerDirectiveErrors } from "./ownerDirective.errors.js";
import type { OwnerJudgementPlan } from "./ownerDirectivePort.js";
import {
  type OwnerDirectiveSyncOutcome,
  type OwnerJudgementTransition,
  type StoredOwnerJudgement,
  snapshotMarkerRefusal,
} from "./ownerJudgementRecords.js";

/** The two partial unique indexes a racing activation meets. */
const ACTIVE_INDEXES: ReadonlySet<string> = new Set(["uq_owner_correction_active", "uq_owner_directive_active"]);

/**
 * One reading snapshot: the active rows FIRST, then the counted marker, then the marker's verdict. The order is
 * the point — a deletion the rows saw is one the count sees too.
 *
 * @param readActive reads both tables' active versions through the snapshot
 * @param readMarker reads the counted import marker through the SAME snapshot
 * @returns the active versions, or the marker's refusal
 */
export async function snapshotOver({
  readActive,
  readMarker,
}: {
  readActive: () => Promise<StoredOwnerJudgement>;
  readMarker: () => Promise<ImportMarker | undefined>;
}): Promise<Result<StoredOwnerJudgement, OwnerDirectiveError>> {
  const stored = await readActive();
  const refused = snapshotMarkerRefusal({ marker: await readMarker() });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok(stored);
}

/**
 * One memory event inside its writing transaction: read the snapshot, plan against it, apply only a plan that
 * succeeded. A refused read or plan applies nothing.
 *
 * @param read the snapshot read
 * @param plan decides the transition and the answer from what was read
 * @param apply writes the transition
 * @returns the plan's answer, or the read's or the plan's refusal
 */
export async function planThenApply({
  read,
  plan,
  apply,
}: {
  read: () => Promise<Result<StoredOwnerJudgement, OwnerDirectiveError>>;
  plan: (request: { readonly stored: StoredOwnerJudgement }) => Result<OwnerJudgementPlan, OwnerDirectiveError>;
  apply: (request: { readonly transition: OwnerJudgementTransition }) => Promise<void>;
}): Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>> {
  const stored = await read();
  if (stored.isErr()) {
    return err(stored.error);
  }
  const planned = plan({ stored: stored.value });
  if (planned.isErr()) {
    return err(planned.error);
  }
  await apply({ transition: planned.value.transition });
  return ok(planned.value.answer);
}

/**
 * A reading transaction whose throw is a store outage, never an empty answer.
 *
 * @param run the transaction
 * @returns what it answered, or `OWNER_DIRECTIVE_STORE_UNAVAILABLE` naming what it threw
 */
export async function guardedRead({
  run,
}: {
  run: () => Promise<Result<StoredOwnerJudgement, OwnerDirectiveError>>;
}): Promise<Result<StoredOwnerJudgement, OwnerDirectiveError>> {
  try {
    return await run();
  } catch (cause) {
    return err(
      OwnerDirectiveErrors.storeUnavailable({
        doing: "read the active owner directives",
        reason: thrownReason({ cause }),
      }),
    );
  }
}

/**
 * A writing transaction whose throw is a racing writer when it met an active-version index or a serialization
 * failure, and a store outage otherwise. Either way the transaction rolled back, so nothing was written.
 *
 * @param run the transaction
 * @returns what it answered, `OWNER_DIRECTIVE_WRITE_CONFLICT`, or `OWNER_DIRECTIVE_STORE_UNAVAILABLE`
 */
export async function guardedWrite({
  run,
}: {
  run: () => Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>>;
}): Promise<Result<OwnerDirectiveSyncOutcome, OwnerDirectiveError>> {
  try {
    return await run();
  } catch (cause) {
    const reason = thrownReason({ cause });
    if (isActiveVersionRace({ cause })) {
      return err(OwnerDirectiveErrors.writeConflict({ reason }));
    }
    return err(OwnerDirectiveErrors.storeUnavailable({ doing: "record a memory's owner directives", reason }));
  }
}

/**
 * Whether a thrown failure is a racing writer: an activation meeting an active-version index, or the writing
 * transaction's `repeatable read` snapshot refusing a row another writer changed first (`40001`). Either way
 * nothing was written. Drizzle wraps the driver's error, so the walk follows `cause` a few links down.
 *
 * @param cause what the transaction threw
 * @returns true for a unique violation on either active-version index, or a serialization failure
 */
export function isActiveVersionRace({ cause }: { cause: unknown }): boolean {
  let current: unknown = cause;
  for (let depth = 0; depth < 4 && isRecord(current); depth += 1) {
    const constraint = current["constraint_name"];
    if (current["code"] === "23505" && typeof constraint === "string" && ACTIVE_INDEXES.has(constraint)) {
      return true;
    }
    if (current["code"] === "40001") {
      return true;
    }
    current = current["cause"];
  }
  return false;
}

/**
 * The message of whatever a transaction threw.
 *
 * @param cause what was thrown
 * @returns its message, or a fixed sentence for a non-Error throw
 */
function thrownReason({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return "unknown failure";
}
