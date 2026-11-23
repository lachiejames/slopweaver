/**
 * The failures beneath the owner's OWN hold, read back off the slot-attempt ledger — the durable trace a failure
 * leaves when its finding neither registered nor recorded as owed.
 *
 * ## Why the ledger, and not another store
 *
 * The owner's hold names no finding (a hold that did would be a failure hold, lifted by a fix rather than by the
 * owner's word), so a firing admitted before the owner held the row and failing after leaves nothing on the
 * definition to read. Its debt file (`./findingDebt.ts`) is one write; if that write fails too, a later healthy
 * tick would see only the owner's hold.
 * But the failure's own outcome was already settled onto the ledger BEFORE the hold-and-finding path ran
 * (`../../cli/commands/automation/slotSettle.ts`, `slotDeadLetter.ts`), and the finding's slug is derived from that
 * row (`./failureHold.ts`'s `failureFindingSlug`). So the obligation is reconstructed rather than re-written.
 *
 * ## Which rows count
 *
 * Only a `failed` or `dead` outcome settled at or after the hold's `askedIso`, on a row the owner holds now. Nothing
 * fires a held row, so a failure settled after the hold is exactly the race this exists for; an older one predates
 * the hold and was a failure hold's business. A ledger file that will not read is COUNTED, never skipped silently —
 * but only while some owner hold stands, so a corrupt row elsewhere cannot fail a tick that has nothing to look for.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

import { parseStrictIsoInstantMs } from "#lib/date.js";
import { errorMessage } from "#lib/errorMessage.js";
import { isAbsentError, nonBlockingFileBytes } from "#lib/presentFile.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { stateHomePaths } from "../../stateHome.js";
import type { RecipeDefinition } from "./definition.js";
import { failureFindingSlug } from "./failureHold.js";
import type { RecipeSlotAttempt } from "./slotAttempt.js";
import { attemptOf } from "./slotAttemptCodec.js";

/** One failure beneath the owner's hold, and the finding it should have filed. */
interface OwnerHeldFailure {
  readonly recipeId: string;
  readonly slotIso: string;
  readonly attempt: number;
  /** The slug its finding was registered — or should have been — under. */
  readonly finding: string;
}

/** What one scan found. */
export interface OwnerHeldFailures {
  readonly failures: readonly OwnerHeldFailure[];
  /** What would not read — the ledger, a row in it, or a timestamp that is no datetime — so a failure may be unseen. */
  readonly unread: readonly string[];
}

/** When each standing owner hold was asked, and every hold whose instant would not read. */
function ownerHoldsSince({ definitions }: { readonly definitions: readonly RecipeDefinition[] }): {
  readonly heldSince: ReadonlyMap<string, number>;
  readonly unread: string[];
} {
  const heldSince = new Map<string, number>();
  const unread: string[] = [];
  for (const { hold, recipeId } of definitions) {
    if (hold === undefined || hold.finding !== undefined || hold.clearedBy !== null) {
      continue;
    }
    // Strict, so an impossible February date is refused rather than rolled into March by `Date.parse`.
    const since = parseStrictIsoInstantMs({ text: hold.askedIso });
    // A hold whose instant is no datetime cannot order a failure against it, so it is NAMED, never compared.
    // Two parsed rows can share a recipeId, so the EARLIEST hold wins: a later one would hide a failure between them.
    const earlier = heldSince.get(recipeId);
    if (since !== undefined) {
      heldSince.set(recipeId, earlier === undefined ? since : Math.min(earlier, since));
    } else {
      unread.push(`the owner hold on ${recipeId}, whose askedIso ${JSON.stringify(hold.askedIso)} is no datetime`);
    }
  }
  return { heldSince, unread };
}

/** One ledger row, or `undefined` when it will not read as one. */
function readSlotRow({ path }: { readonly path: string }): RecipeSlotAttempt | undefined {
  try {
    // Non-blocking, since a FIFO would hang the tick, and strict, since a repaired byte is a row misread.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(nonBlockingFileBytes({ path }));
    return attemptOf({ value: safeJsonParse({ label: path, text }) });
  } catch {
    return undefined;
  }
}

/** What one ledger row says: a failure beneath the owner's hold, a line that would not read, or nothing to report. */
function judgeSlotRow({
  heldSince,
  name,
  row,
}: {
  readonly heldSince: ReadonlyMap<string, number>;
  readonly name: string;
  readonly row: RecipeSlotAttempt | undefined;
}): { readonly failure: OwnerHeldFailure } | { readonly unread: string } | null {
  if (row === undefined) {
    return { unread: `slot row ${name}` };
  }
  const since = heldSince.get(row.recipeId);
  const { outcome } = row;
  const failed = outcome !== null && (outcome.kind === "failed" || outcome.kind === "dead");
  if (since === undefined || !failed) {
    return null;
  }
  const settledAt = parseStrictIsoInstantMs({ text: outcome.settledAtIso });
  if (settledAt === undefined) {
    return { unread: `slot row ${name}, whose settledAtIso ${JSON.stringify(outcome.settledAtIso)} is no datetime` };
  }
  if (settledAt < since) {
    return null;
  }
  const { attempt, recipeId, slotIso } = row;
  return { failure: { attempt, finding: failureFindingSlug({ attempt, recipeId, slotIso }), recipeId, slotIso } };
}

/**
 * Every failure settled beneath a standing owner hold, in ledger file order.
 *
 * @param definitions the rows to look for owner holds on
 * @param home the state home whose ledger to read
 * @returns the failures and their findings, and what would not read
 */
export function ownerHeldFailures({
  definitions,
  home,
}: {
  readonly definitions: readonly RecipeDefinition[];
  readonly home: string;
}): OwnerHeldFailures {
  const { heldSince, unread } = ownerHoldsSince({ definitions });
  const dir = stateHomePaths({ home }).live.recipe.slotAttemptsDir;
  if (heldSince.size === 0) {
    return { failures: [], unread };
  }
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch (cause) {
    // Only a ledger genuinely not there holds nothing: `existsSync` answers false on EACCES too.
    if (isAbsentError({ error: cause, path: dir })) {
      return { failures: [], unread };
    }
    return { failures: [], unread: [...unread, `${dir} would not list: ${errorMessage({ error: cause })}`] };
  }
  const failures: OwnerHeldFailure[] = [];
  for (const name of names.toSorted()) {
    const judged = judgeSlotRow({ heldSince, name, row: readSlotRow({ path: join(dir, name) }) });
    if (judged === null) {
      continue;
    }
    if ("failure" in judged) {
      failures.push(judged.failure);
    } else {
      unread.push(judged.unread);
    }
  }
  return { failures, unread };
}
