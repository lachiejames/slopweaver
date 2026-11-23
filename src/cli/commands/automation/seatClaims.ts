/**
 * Taking and giving back a seat's claims — the half of `./seat.ts` that writes the ledger, split from the
 * planning and the spawning along that seam.
 *
 * A seat claims every planned row BEFORE it opens a session and gives every claim back if the session never
 * opens (`./seat.ts` § "The order of operations is the whole design"). A row a failure held after the plan was
 * judged is passed over here, at the moment of its claim, rather than seated (`live/automation/failureHoldStore.ts`).
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { loadLiftedRecipeDefinitions } from "../../../live/automation/definitionStore.js";
import { rowHeldNow } from "../../../live/automation/failureHoldStore.js";
import { releaseSlotAttempt } from "../../../live/automation/slotLedger.js";
import { stateHomePaths } from "../../../stateHome.js";
import { productionRecipeClaimDeps, type RecipeClaimDeps, slotDepsOf, slotToLease } from "./claim.js";
import type { RecipeSeatDeps, SeatPlan } from "./seat.js";
import type { SeatedRow } from "./seatAsk.js";
import { takeSlot } from "./slotRun.js";

/**
 * Drop the lease on a row the caller has just finished running, having already settled its firing.
 *
 * The seated session's path, and the reason it is not `--release --exit-code`: `automation run-due --claim-id`
 * settles the firing itself, through the same ledger the rest of the tick uses, so a second settle would
 * describe the same firing twice and each write is a chance for the two paths to disagree.
 *
 * Kept as a named function because `./seat.ts` releases every firing it took when the session it took them
 * for never opened, and that path must not settle anything: the run did not happen.
 *
 * @param home the state home the ledger lives under
 * @param nowIso the reference instant
 * @param recipeId the row whose lease is spent
 * @param slotIso the firing it leased
 * @param claimId the token the run was given
 * @returns `null` on success, or the reason the firing was not this caller's to give back
 */
export function dropSpentClaim({
  home,
  nowIso,
  recipeId,
  slotIso,
  claimId,
}: {
  readonly home: string;
  readonly nowIso: string;
  readonly recipeId: string;
  readonly slotIso: string;
  readonly claimId: string;
}): Result<null> {
  const released = releaseSlotAttempt({ holderToken: claimId, home, nowIso, recipeId, slotIso });
  if (released.isErr()) {
    return err([released.error.message]);
  }
  return ok(null);
}

/** One firing a caller has taken, and the token it quotes back. */
export interface SeatedSlot {
  readonly claimId: string;
  readonly slotIso: string;
}

/**
 * Take one row's current firing on behalf of a session about to be seated for it, and hand back the token.
 *
 * `automation seat` needs the minted token to give to the session it opens, which the VERB only ever printed.
 * This is that act as a function: the same ledger, the same lease rules, and the attempt itself as the
 * return value rather than a line to parse back out of stdout.
 *
 * @param deps the injected edges
 * @param home the state home the ledger lives under
 * @param definition the row being claimed
 * @param claimedBy who is taking it — the board row the seated session will work
 * @returns the firing taken and the token that holds it, or every reason it was refused
 */
export async function seatClaim({
  deps,
  home,
  definition,
  claimedBy,
}: {
  readonly deps: RecipeClaimDeps;
  readonly home: string;
  readonly definition: RecipeDefinition;
  readonly claimedBy: string;
}): Promise<Result<SeatedSlot>> {
  const nowIso = deps.now();
  const runsPath = stateHomePaths({ home }).live.recipe.definitionRunsJson;
  const slot = slotToLease({ definition, nowIso, runsPath });
  if (slot.isErr()) {
    return err(slot.error);
  }
  const taken = await takeSlot({
    definition,
    deps: slotDepsOf({ deps }),
    holder: claimedBy,
    holderPid: null,
    home,
    slotIso: slot.value,
  });
  if (taken.kind === "refused") {
    return err([taken.line]);
  }
  return ok({ claimId: taken.attempt.holderToken, slotIso: taken.attempt.slotIso });
}

/**
 * Claim every planned row, or hand back the ones already claimed so the caller can release them.
 *
 * @param deps the injected edges
 * @param home the state home whose claims to write
 * @param plan the rows this seat is taking
 * @returns every row claimed, or the claims taken so far and the reason the next one failed
 */
export async function claimPlannedRows({
  deps,
  home,
  plan,
}: {
  readonly deps: RecipeSeatDeps;
  readonly home: string;
  readonly plan: SeatPlan;
}): Promise<
  Result<readonly SeatedRow[], { readonly taken: readonly SeatedRow[]; readonly problems: readonly string[] }>
> {
  const definitionsDir = stateHomePaths({ home }).live.recipe.definitionsDir;
  const roster = loadLiftedRecipeDefinitions({ home });
  const taken: SeatedRow[] = [];
  for (const row of plan.rows) {
    const definition = roster.definitions.find((candidate) => candidate.recipeId === row.recipeId);
    if (definition === undefined) {
      return err({ problems: [`recipe ${row.recipeId} · no such definition in ${definitionsDir}`], taken });
    }
    // A row a failure held after the plan was judged is SKIPPED, not a reason to abort the whole seat: the
    // hold is the store working, and every other planned row is still due.
    const heldBecause = rowHeldNow({ home, recipeId: row.recipeId });
    if (heldBecause !== null) {
      deps.writeOut(`recipe ${row.recipeId} · HELD since this seat was planned, so not seated — ${heldBecause}`);
      continue;
    }
    const claimed = await seatClaim({
      claimedBy: plan.slug,
      definition,
      deps: {
        ...productionRecipeClaimDeps(),
        mintClaimId: deps.mintId,
        now: deps.now,
        processAlive: deps.processAlive,
      },
      home,
    });
    if (claimed.isErr()) {
      return err({ problems: claimed.error, taken });
    }
    taken.push({
      claimId: claimed.value.claimId,
      kind: definition.kind,
      recipeId: row.recipeId,
      slotIso: claimed.value.slotIso,
    });
  }
  return ok(taken);
}

/**
 * Drop every claim this seat took, because the session it took them for was never opened.
 *
 * @param deps the injected edges
 * @param home the state home whose claims to write
 * @param taken the rows claimed so far
 * @returns whether every claim was dropped — a claim left standing holds its row from the next pass, so a caller
 *   that would answer NOT YET answers a fault instead
 */
export function releaseSeatedRows({
  deps,
  home,
  taken,
}: {
  readonly deps: RecipeSeatDeps;
  readonly home: string;
  readonly taken: readonly SeatedRow[];
}): boolean {
  let everyReleased = true;
  for (const row of taken) {
    const dropped = dropSpentClaim({
      claimId: row.claimId,
      home,
      nowIso: deps.now(),
      recipeId: row.recipeId,
      slotIso: row.slotIso,
    });
    if (dropped.isErr()) {
      dropped.error.forEach((problem) => {
        deps.writeDiagnostic(problem);
      });
      everyReleased = false;
      continue;
    }
    deps.writeOut(`recipe ${row.recipeId} · claim released — no session was opened for it`);
  }
  return everyReleased;
}
