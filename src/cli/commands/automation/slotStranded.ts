/**
 * What a take refuses BEFORE it asks the ledger for its own firing: a row held since the roster was read, and
 * a run stranded on an earlier firing. Both are the row's own standing failure, so neither lets this firing
 * run past it. And the guard its ledger write goes through, which asks the hold and the retirement once more
 * under the lock. The take itself is `./slotRun.ts`.
 */
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { liftedFailureHoldAskedIso, rowHeldNow, startUnlessHeld } from "../../../live/automation/failureHoldStore.js";
import { findStrandedAttempt } from "../../../live/automation/strandedAttempt.js";
import { abandonedDeath, deadLetter, refusedLine } from "./slotDeadLetter.js";
import type { SlotRunDeps, SlotTake } from "./slotRun.js";

/** How a take refused on a hold or retirement placed since its roster was read opens its line. */
const HELD_SINCE_READ = "HELD since the roster was read";

/**
 * Make one ledger write that begins a firing, with the row's hold and retirement asked again UNDER the definition
 * hold lock and the write made before that lock is released — `startUnlessHeld` says why that ordering is the
 * property — as the refusal a take reports when it does not.
 *
 * @param definition the row whose firing the write begins
 * @param home the state home the hold, the retirement and the ledger live under
 * @param slotIso the firing being taken, named in a refusal's line
 * @param write the ledger write, made only while the row is neither held nor retired
 * @returns what the write answered, or the take to report in its place
 */
export function writeUnlessHeld<T>({
  definition,
  home,
  nowIso,
  slotIso,
  write,
}: {
  readonly definition: RecipeDefinition;
  readonly home: string;
  readonly nowIso: string;
  readonly slotIso: string;
  readonly write: () => T;
}): { readonly kind: "refused"; readonly take: SlotTake } | { readonly kind: "written"; readonly written: T } {
  const outcome = startUnlessHeld({ home, nowIso, recipeId: definition.recipeId, start: write });
  if (outcome.kind === "started") {
    return { kind: "written", written: outcome.value };
  }
  const what =
    outcome.kind === "held"
      ? `${HELD_SINCE_READ} — ${outcome.why}`
      : `not taken — ${outcome.why}; the next tick judges it again`;
  return {
    kind: "refused",
    take: {
      died: false,
      failed: false,
      kind: "refused",
      line: refusedLine({ recipeId: definition.recipeId, slotIso, what }),
    },
  };
}

/**
 * Refuse a take of a row a failure held after the roster that chose it was read. Nothing runs and nothing is
 * wrong with the take, so the refusal does not fail.
 *
 * @param definition the row being taken
 * @param home the state home the hold is read under
 * @param slotIso the firing being taken, named in the line
 * @returns the refusal to report, or `null` when the row is not held
 */
export function heldSinceRead({
  definition,
  home,
  slotIso,
}: {
  readonly definition: RecipeDefinition;
  readonly home: string;
  readonly slotIso: string;
}): SlotTake | null {
  const heldBecause = rowHeldNow({ home, recipeId: definition.recipeId });
  if (heldBecause === null) {
    return null;
  }
  const what = `${HELD_SINCE_READ} — ${heldBecause}`;
  return {
    died: false,
    failed: false,
    kind: "refused",
    line: refusedLine({ recipeId: definition.recipeId, slotIso, what }),
  };
}

/**
 * Hold the row on an earlier firing whose run started and died unjudged, before this firing runs. That
 * death is this row's failure, so it holds the row here rather than the row firing again past it
 * (`live/automation/strandedAttempt.ts`) — unless it was taken before the row's lifted failure hold, which its fix
 * or the owner's `clearedBy` already answered.
 *
 * @param definition the row being taken
 * @param deps the injected edges; `processAlive` judges each earlier holder
 * @param holder who is taking the firing, recorded as who observed the death
 * @param home the state home the ledger lives under
 * @param nowIso the instant the take judges every earlier lease against
 * @param slotIso the firing being taken, which the walk looks back from
 * @returns the dead take to report, or `null` when no earlier firing is stranded
 */
export async function holdStranded({
  definition,
  deps,
  holder,
  home,
  nowIso,
  slotIso,
}: {
  readonly definition: RecipeDefinition;
  readonly deps: SlotRunDeps;
  readonly holder: string;
  readonly home: string;
  readonly nowIso: string;
  readonly slotIso: string;
}): Promise<SlotTake | null> {
  const stranded = findStrandedAttempt({
    cadence: definition.cadence,
    coveredBeforeIso: liftedFailureHoldAskedIso({ home, recipeId: definition.recipeId }),
    home,
    nowIso,
    processAlive: deps.processAlive,
    recipeId: definition.recipeId,
    slotIso,
  });
  if (stranded === null) {
    return null;
  }
  const death = abandonedDeath({ definition, verdict: stranded.verdict });
  if (death === undefined) {
    return null;
  }
  const letter = await deadLetter({
    definition,
    deps,
    detail: death.detail,
    home,
    judged: { attempt: stranded.verdict.attempt, holderToken: stranded.verdict.holderToken },
    observedBy: holder,
    reason: death.reason,
    slotIso: stranded.slotIso,
    what: death.what,
  });
  return { died: letter.died, failed: letter.settlement.failed, kind: "refused", line: letter.settlement.line };
}
