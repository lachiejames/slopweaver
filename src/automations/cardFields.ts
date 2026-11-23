/**
 * The card fields `./card.ts` reads straight off one store row each — the definition, its newest run stamp, its
 * standing hold and its purpose — split from the fold that composes them, so the fold stays one screen.
 */
import type { RecipeDefinition } from "../live/automation/definition.js";
import type { RecipeDueVerdict } from "../live/automation/definitionDue.js";
import type { RecipeDefinitionRun } from "../live/automation/definitionRunStore.js";
import { ownerHoldIsOwners } from "../live/automation/ownerHoldPlacedBy.js";
import type { AutomationCard } from "./card.js";
import type { StandingHold } from "./health.js";
import type { AutomationPurpose } from "./purpose.js";
import { corpusSourceOf, whatOf } from "./rowAsks.js";

/**
 * The row's newest run stamp as the card's two run fields.
 *
 * @returns its exit code and when it ran, both `null` when it has never run
 */
export function lastRunOf({
  run,
}: {
  run: RecipeDefinitionRun | undefined;
}): Pick<AutomationCard, "lastExitCode" | "lastRunAtIso"> {
  if (run === undefined) {
    return { lastExitCode: null, lastRunAtIso: null };
  }
  return { lastExitCode: run.exitCode, lastRunAtIso: run.lastRunAtIso };
}

/**
 * A standing hold as the card's fix row and pause reason. An owner hold no word of the owner's names never shows its stored
 * reason bare: that free text is what wrote "owner chose 'Hold, discussion first'" for a keypress the owner never made, so it
 * is quoted as the hold's own note, under UNOWNED.
 *
 * @returns the fix row and pause reason, each `null` unless the hold is of its kind
 */
export function holdFieldsOf({
  hold,
  recipeId,
}: {
  hold: StandingHold | null;
  recipeId: string;
}): Pick<AutomationCard, "fixRow" | "pauseReason"> {
  let pauseReason: string | null = null;
  if (hold?.kind === "owner") {
    pauseReason = ownerHoldIsOwners({ recipeId, state: hold.placedByState })
      ? hold.reason
      : `UNOWNED — no word of the owner's names this automation; the hold's own note says “${hold.reason}”`;
  }
  return { fixRow: hold?.kind === "fix" ? hold.finding : null, pauseReason };
}

/**
 * The card's plain name and what it is for.
 *
 * @returns both, or both `null` when this build declares no purpose for it
 */
export function purposeFieldsOf({
  purpose,
}: {
  purpose: AutomationPurpose | null;
}): Pick<AutomationCard, "forWhat" | "name"> {
  if (purpose === null) {
    return { forWhat: null, name: null };
  }
  return { forWhat: purpose.forWhat, name: purpose.name };
}

/**
 * The card fields read straight off the row's definition, and whether it is switched on.
 *
 * @param hold the standing hold, since an owner hold switches the row off whatever `enabled` says
 * @returns the definition's own fields as the card names them
 */
export function definitionFieldsOf({
  definition,
  hold,
  verdict,
}: {
  definition: RecipeDefinition;
  hold: StandingHold | null;
  verdict: RecipeDueVerdict;
}): Pick<
  AutomationCard,
  "cadence" | "destination" | "effect" | "kind" | "recipeId" | "switchedOn" | "syncSource" | "what"
> {
  return {
    cadence: definition.cadence,
    destination: definition.destination.kind,
    effect: definition.effect,
    kind: definition.kind,
    recipeId: definition.recipeId,
    switchedOn: definition.enabled && verdict.offReason !== "disabled" && hold?.kind !== "owner",
    syncSource: corpusSourceOf({ definition }),
    what: whatOf({ definition }),
  };
}
