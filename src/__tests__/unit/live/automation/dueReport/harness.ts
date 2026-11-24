/**
 * The DUE-ASKS report tests' shared fixtures: one clock instant, and the row, verdict and claim builders every
 * test file overrides field by field.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";
import type { RecipeDefinitionClaim } from "../../../../../live/automation/definitionClaim.js";
import type { RecipeDueVerdict } from "../../../../../live/automation/definitionDue.js";

export const NOW_ISO = "2026-09-08T12:05:00.000Z";

/**
 * An hourly `verb-run` row, overridable field by field.
 *
 * @returns the hourly atlas-freshness definition with the case's overrides spread over it
 */
export function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: "verb-run",
    onMissed: "backfill",
    params: { argv: ["atlas", "freshness"] },
    recipeId: "atlas-freshness",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * A due verdict for one row, overridable field by field.
 *
 * @returns a DUE verdict on the noon slot with the case's overrides spread over it
 */
export function verdict(over: Partial<RecipeDueVerdict> = {}): RecipeDueVerdict {
  return {
    deferredSlotIso: null,
    due: true,
    firingsSinceWatermark: 1,
    lastRunAtIso: "2026-09-08T11:30:00.000Z",
    line: "recipe atlas-freshness · DUE",
    recipeId: "atlas-freshness",
    slotIso: "2026-09-08T12:00:00.000Z",
    slotsOwedAfterThis: 0,
    watermarkIso: "2026-09-08T11:00:00.000Z",
    ...over,
  };
}

/**
 * One stored claim.
 *
 * @returns the supervisor tick's claim on the noon slot with the case's overrides spread over it
 */
export function claim(over: Partial<RecipeDefinitionClaim> = {}): RecipeDefinitionClaim {
  return {
    claimId: "claim-0001",
    claimedAtIso: "2026-09-08T12:00:00.000Z",
    claimedBy: "supervisor-tick",
    expiresAtIso: "2026-09-08T13:00:00.000Z",
    slotIso: "2026-09-08T12:00:00.000Z",
    ...over,
  };
}
