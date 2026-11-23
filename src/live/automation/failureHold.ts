/**
 * A FAILURE HOLD — the pure rules for a hold the store places when a firing fails, and for when it lifts.
 *
 * A row whose firing fails is paused until its fix lands, never cooled and fired again to fail the same way.
 * Measured: nine rows had failed every firing for days, each retry filing its own board finding, so one broken Vanta sync stood
 * behind five findings and a ranked queue of duplicates. So a failure writes ONE hold naming ONE finding, and
 * nothing fires the row again until that finding is settled.
 *
 * ## What lifts it, and why each case is what it is
 *
 * An owner hold ({@link RecipeHold} with no `finding`) lifts only on `clearedBy`, exactly as before. A failure
 * hold ALSO lifts when its finding's row says the fix landed:
 *
 * - **settled `answered`** — the fix is the answer, and its witness names it. Lifted.
 * - **settled `filed`** — the finding became another row. Followed ONE step: lifted only when that row is
 *   `done`, because lifting on the filing alone restarts a job with no fix in it.
 * - **settled `declined`** — the owner talked the fix away. Held; only the owner's word on `clearedBy` lifts it now.
 * - **unsettled, missing, or unreadable** — held, and the line says which. A finding that cannot be read is
 *   never read as fixed: that is the failure direction a rail like this must take.
 */
import { createHash } from "node:crypto";

import type { DocStatus } from "../../handover/doc.js";
import type { DerivedRowReadError, ReadableDerivedRowState } from "../../handover/rowState.js";
import { isSafeSlug } from "../../handover/runStore.js";
import type { Result } from "../../lib/result.js";
import type { RecipeHold } from "./definition.js";

/**
 * Where the fix a failure hold waits on stands on the board, decided by the same case that decides `held` — so the
 * Automations page can say who is on it without parsing `line`. It never says whether a session is ALIVE: a row's
 * status carries no liveness, and a dead session leaves a row `in-progress`.
 *
 * - `landed` — settled answered, or filed as a row that is done: the hold lifts.
 * - `queued` — unsettled and not yet taken up (`draft`, `ready`, `unknown`).
 * - `taken` — unsettled and `in-progress`: a session took it up.
 * - `parked` — unsettled and `paused`.
 * - `closed-unsettled` — the row ended (`done`, `cancelled`, `rejected`) without being settled, so nothing lifts it.
 * - `declined` — the owner talked the fix away; only the owner's word lifts the hold now.
 * - `filed` — filed as another row that is not done; `status` is that row's, `null` when it would not read.
 * - `unread` — the finding's own row is missing or would not read.
 */
export type FailureFixStage =
  | { readonly kind: "landed" }
  | { readonly kind: "queued" }
  | { readonly kind: "taken" }
  | { readonly kind: "parked" }
  | { readonly kind: "closed-unsettled"; readonly status: "done" | "cancelled" | "rejected" }
  | { readonly kind: "declined" }
  | { readonly kind: "filed"; readonly status: DocStatus | null }
  | { readonly kind: "unread" };

/** What the board says about a failure hold's finding now, and the one line a reader acts on. */
export interface FailureFindingState {
  /** Whether the hold still stands on the finding's evidence. */
  readonly held: boolean;
  /** Which case decided it, naming the finding and what would lift it. */
  readonly line: string;
  /** Where the fix stands, from the same case. */
  readonly stage: FailureFixStage;
}

/** The stage of an unsettled finding, from its own status alone. */
function unsettledStage({ status }: { status: DocStatus }): FailureFixStage {
  switch (status) {
    case "in-progress":
      return { kind: "taken" };
    case "paused":
      return { kind: "parked" };
    case "done":
    case "cancelled":
    case "rejected":
      return { kind: "closed-unsettled", status };
    case "draft":
    case "ready":
    case "unknown":
      return { kind: "queued" };
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

/** One board row's read, as `readDerivedRowState` answers it. */
type RowRead = Result<ReadableDerivedRowState, DerivedRowReadError>;

/**
 * The finding slug a failed firing files under — one per row, slot and attempt, derived rather than minted so
 * a retried registration names the same row.
 *
 * @param recipeId the row whose firing failed
 * @param slotIso the firing, as `./definitionDue.ts` chose it
 * @param attempt which attempt at that firing failed
 * @returns a board slug the run store can open
 */
export function failureFindingSlug({
  recipeId,
  slotIso,
  attempt,
}: {
  readonly recipeId: string;
  readonly slotIso: string;
  readonly attempt: number;
}): string {
  const readable = `recipe-failing-${recipeId}-${slotIso.toLowerCase().replaceAll(":", "-")}-a${String(attempt)}`;
  if (isSafeSlug({ slug: readable })) {
    return readable;
  }
  const digest = createHash("sha256")
    .update(JSON.stringify([recipeId, slotIso]), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `recipe-failing-${digest}-a${String(attempt)}`;
}

/**
 * Whether a hold stands — the one question `./definitionDue.ts` asks of it.
 *
 * `clearedBy` lifts any hold. A hold with no derived `findingState` stands: that is an owner hold, or a
 * failure hold read in the stored view, which never lifts on evidence it did not read.
 *
 * @param hold the row's hold, if any
 * @returns `true` while the row may not be scheduled
 */
export function holdStands({ hold }: { readonly hold: RecipeHold | undefined }): boolean {
  if (hold === undefined || hold.clearedBy !== null) {
    return false;
  }
  if (hold.findingState === undefined) {
    return true;
  }
  return hold.findingState.held;
}

/** The line for a row that did not read, naming which read failed. */
function unreadLine({ what, error }: { what: string; error: DerivedRowReadError }): string {
  if (error.code === "ROW_MISSING") {
    return `${what} is not on the board, so nothing can say its fix landed`;
  }
  return `${what} did not read whole (${error.why}), and an unread fix is never read as a landed one`;
}

/** A finding settled `filed`: it stands until the row it was filed as is done. */
function filedFindingState({
  finding,
  named,
  settleHint,
  witness,
}: {
  readonly finding: string;
  readonly named: string;
  readonly settleHint: string;
  readonly witness: RowRead | null;
}): FailureFindingState {
  const filedAs = `${finding} was filed as ${named}`;
  if (witness === null) {
    return {
      held: true,
      line: `its finding ${filedAs}, which names no board row — ${settleHint}`,
      stage: { kind: "filed", status: null },
    };
  }
  if (witness.isErr()) {
    return {
      held: true,
      line: `its finding ${filedAs}, and ${unreadLine({ error: witness.error, what: named })}`,
      stage: { kind: "filed", status: null },
    };
  }
  if (witness.value.status === "done") {
    return { held: false, line: `its finding ${filedAs}, which is done`, stage: { kind: "landed" } };
  }
  return {
    held: true,
    line: `its finding ${filedAs}, which is ${witness.value.status} — held until that row is done`,
    stage: { kind: "filed", status: witness.value.status },
  };
}

/**
 * Decide whether a failure hold's finding says the fix landed.
 *
 * @param finding the slug the hold names
 * @param row the finding's own row, read
 * @param witness the row a `filed` settlement names, read — `null` when the finding was not settled `filed`
 *   or named no witness the run store can open
 * @returns whether the hold stands, and the line saying why
 */
export function failureFindingState({
  finding,
  row,
  witness,
}: {
  readonly finding: string;
  readonly row: RowRead;
  readonly witness: RowRead | null;
}): FailureFindingState {
  const settleHint = `settle ${finding} \`answered --witness <the fix>\` once the fix lands`;
  if (row.isErr()) {
    return {
      held: true,
      line: `its finding ${unreadLine({ error: row.error, what: finding })} — ${settleHint}`,
      stage: { kind: "unread" },
    };
  }
  const { settlement, settlementWitness } = row.value;
  // Named with an `if`: a settled row that declares no witness does not read at all (`askRow.ts`), so this
  // arm is a row settled by a build that allowed it, and the line says so rather than naming nothing.
  let named = "no witness";
  if (settlementWitness !== undefined) {
    named = settlementWitness;
  }
  if (settlement === "answered") {
    return { held: false, line: `its finding ${finding} was settled answered (${named})`, stage: { kind: "landed" } };
  }
  if (settlement === "declined") {
    return {
      held: true,
      line:
        `its finding ${finding} was settled declined, so no fix is coming — only the owner's word on the row's ` +
        "`hold.clearedBy` lifts it now; ask for it on the Queue",
      stage: { kind: "declined" },
    };
  }
  if (settlement === "filed") {
    return filedFindingState({ finding, named, settleHint, witness });
  }
  return {
    held: true,
    line: `its finding ${finding} is ${row.value.status} and unsettled — ${settleHint}`,
    stage: unsettledStage({ status: row.value.status }),
  };
}

/**
 * The `reason` a failure hold records — what failed, when, and the finding whose fix lifts it.
 *
 * @param recipeId the row that failed
 * @param slotIso the firing that failed
 * @param attempt which attempt failed
 * @param what how it failed, in one line
 * @param finding the finding slug the hold names
 * @returns the hold's reason
 */
export function failureHoldReason({
  recipeId,
  slotIso,
  attempt,
  what,
  finding,
}: {
  readonly recipeId: string;
  readonly slotIso: string;
  readonly attempt: number;
  readonly what: string;
  readonly finding: string;
}): string {
  return (
    `held by the store: ${recipeId}'s ${slotIso} firing failed on attempt ${String(attempt)} (${what}); a row ` +
    `that fails once is paused until its fix lands, never fired again to fail the same way — the fix is board ` +
    `row ${finding}`
  );
}
