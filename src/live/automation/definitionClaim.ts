/**
 * The CLAIM on one due row — what stops an automation being run twice once a SPAWN is involved.
 *
 * **A lease claimed on spawn that fails safe.** Without this module the question could not arise, because
 * `automation run-due` ran a row and stamped it in the same process. The supervisor SPAWNS a session for a
 * session-shaped row instead — and between that spawn and the spawned session finishing, the row still
 * reads DUE, so the next tick spawns it again.
 *
 * ## Why this is not `admit/operationLock.ts`
 *
 * The design page proposed that lock and was wrong, in a way worth recording rather than quietly fixing:
 * it decides staleness by `process.kill(pid, 0)` liveness OR age, and BOTH halves fail here. The claimant
 * is a short-lived CLI invocation that exits the moment it has spawned the worker, so its pid is gone
 * within a second and the very next read treats the claim as stale. A lock whose holder is expected to
 * outlive the work is the wrong primitive for a claim whose holder is expected to exit immediately.
 *
 * ## The expiry is DERIVED, because a constant here would be a heuristic
 *
 * A claim expires at the row's OWN NEXT FIRING, computed from its cadence. There is no TTL constant in
 * this file and there is deliberately none to tune. There is no heuristic, and lateness is derived from the
 * cadence period, so a bare number of minutes here would be exactly the invented threshold both refuse.
 *
 * It also fails safe in the direction the design requires, and the bound is the strongest one available
 * rather than a compromise: a claim can never outlive the schedule it belongs to, because at the next
 * firing the row is due again regardless of what any claim says. So a worker that died leaves a row that
 * comes back no later than its own next slot — one missed slot at worst, never a permanently silent row —
 * and a worker still running past its own next firing loses its claim to a schedule that has genuinely
 * moved on.
 */
import { CronExpressionParser } from "cron-parser";

/** One row's live claim. */
export interface RecipeDefinitionClaim {
  /**
   * A random token minted with the claim, quoted back to finish it.
   *
   * It exists for one failure a Codex pre-mortem named: a worker that finishes AFTER its claim expired and
   * a successor has taken the row would otherwise stamp and release the successor's claim, and both runs
   * would look like one. The token makes that arrive as a refusal instead of as a silent overwrite.
   */
  readonly claimId: string;
  /** When the claim was taken. */
  readonly claimedAtIso: string;
  /** The row's own next firing after the claim, past which the claim is spent. */
  readonly expiresAtIso: string;
  /** Who took it, as free text a reader can chase — a workspace name, a session key, a verb. */
  readonly claimedBy: string;
  /**
   * The cadence slot this claim leases — the watermark its finish stamps.
   *
   * `null` only on a claim stored before claims recorded a slot. Such a claim lives at most one period, and
   * its finish stamps {@link RecipeDefinitionClaim.claimedAtIso}: every firing up to the claim is what it was
   * spawned for, and a firing after it must stay due.
   */
  readonly slotIso: string | null;
}

/** Every row's claim, keyed by recipe id. */
export type RecipeDefinitionClaims = Readonly<Record<string, RecipeDefinitionClaim>>;

/** Why a claim could not be taken, or could not be judged. */
export interface ClaimCadenceUnschedulableError {
  readonly code: "CADENCE_UNSCHEDULABLE";
  readonly message: string;
  readonly recipeId: string;
}

/** A live claim already holds the row, so this caller may not take it. */
export interface ClaimAlreadyHeldError {
  readonly code: "ALREADY_HELD";
  readonly message: string;
  readonly recipeId: string;
  readonly heldBy: string;
  readonly expiresAtIso: string;
}

/** The token offered to finish a claim is not the token the live claim carries. */
export interface ClaimTokenMismatchError {
  readonly code: "CLAIM_TOKEN_MISMATCH";
  readonly message: string;
  readonly recipeId: string;
}

/**
 * Construct one claim refusal. Tests build fixtures through these, never a hand-built literal.
 *
 * @internal
 */
export const RecipeClaimErrors = {
  alreadyHeld: ({
    recipeId,
    heldBy,
    expiresAtIso,
  }: {
    readonly recipeId: string;
    readonly heldBy: string;
    readonly expiresAtIso: string;
  }): ClaimAlreadyHeldError => ({
    code: "ALREADY_HELD",
    expiresAtIso,
    heldBy,
    message:
      `recipe '${recipeId}' is already claimed by ${heldBy} until its next firing at ${expiresAtIso} — ` +
      "let that run finish, or wait for the claim to expire with the slot it belongs to",
    recipeId,
  }),
  tokenMismatch: ({ recipeId }: { readonly recipeId: string }): ClaimTokenMismatchError => ({
    code: "CLAIM_TOKEN_MISMATCH",
    message:
      `recipe '${recipeId}' is not held by the claim you are finishing — it expired and another claim has ` +
      "taken the row since. Nothing was stamped and nothing was released; the run you just finished is for " +
      "a slot that has already moved on",
    recipeId,
  }),
  cadenceUnschedulable: ({
    recipeId,
    cadence,
    reason,
  }: {
    readonly recipeId: string;
    readonly cadence: string;
    readonly reason: string;
  }): ClaimCadenceUnschedulableError => ({
    code: "CADENCE_UNSCHEDULABLE",
    message:
      `recipe '${recipeId}' cannot be claimed: its cadence \`${cadence}\` was refused (${reason}), so ` +
      "there is no next firing to expire the claim at",
    recipeId,
  }),
} as const;

/**
 * The row's next cadence firing strictly after an instant — the expiry a claim takes.
 *
 * @param cadence the row's five-field cron expression
 * @param afterIso the instant to look forward from
 * @returns the next firing as an ISO instant, or the reason the cadence could not be read
 */
export function nextFiringAfter({
  cadence,
  afterIso,
}: {
  readonly cadence: string;
  readonly afterIso: string;
}): string | { readonly error: string } {
  try {
    const iterator = CronExpressionParser.parse(cadence, { currentDate: new Date(afterIso) });
    const iso = iterator.next().toISOString();
    // `toISOString` is typed as nullable by the library. A cadence that parsed always yields a firing, so
    // this branch is unreachable in practice and is here so an unreachable one can never become a `null`
    // silently written into a claim's expiry, which would read as expired-forever.
    if (iso == null) {
      return { error: `cadence \`${cadence}\` parsed but produced no next firing` };
    }
    return iso;
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "the cadence is not a cron expression" };
  }
}

/**
 * Whether one stored claim still holds at an instant.
 *
 * An expiry that cannot be parsed reads as EXPIRED rather than as live, which is the fail-safe direction:
 * a corrupt claim releases a row instead of silencing it forever.
 *
 * @param claim the stored claim
 * @param nowIso the reference instant
 * @returns true while the claim is still inside its own expiry
 */
export function claimIsLive({
  claim,
  nowIso,
}: {
  readonly claim: RecipeDefinitionClaim;
  readonly nowIso: string;
}): boolean {
  const expiresMs = Date.parse(claim.expiresAtIso);
  if (Number.isNaN(expiresMs)) {
    return false;
  }
  return Date.parse(nowIso) < expiresMs;
}

/**
 * The claim on one row, or `undefined` when it is unclaimed or its claim has expired.
 *
 * @param claims every stored claim
 * @param recipeId the row being asked about
 * @param nowIso the reference instant
 * @returns the live claim, or `undefined`
 */
export function liveClaimFor({
  claims,
  recipeId,
  nowIso,
}: {
  readonly claims: RecipeDefinitionClaims;
  readonly recipeId: string;
  readonly nowIso: string;
}): RecipeDefinitionClaim | undefined {
  const claim = claims[recipeId];
  if (claim === undefined || !claimIsLive({ claim, nowIso })) {
    return undefined;
  }
  return claim;
}
