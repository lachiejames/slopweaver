/**
 * Writing a recipe store into an explicit temp home: definition files and a run-stamps file, in the shapes
 * the real readers parse. Shared by the silent-row reader's own test and the `recipe-stopped` monitor's pass
 * test, so the two cannot drift on what a stored row looks like.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { RECIPE_DEFINITION_RUNS_SCHEMA_VERSION } from "../../../../live/automation/definitionRunStore.js";
import { stateHomePaths } from "../../../../stateHome.js";

/**
 * A daily verb-run row, overridable field by field.
 *
 * @param over the fields a case changes
 * @returns the definition
 */
export function dailyRow(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "30 9 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: "verb-run",
    onMissed: "backfill",
    params: { argv: ["atlas", "freshness"] },
    recipeId: "vulnfix-digest-acme-admin",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * Write each definition as its own file in the home's definitions directory.
 *
 * @param home the explicit temp home
 * @param rows the definitions to write, one file each
 * @returns the definitions directory
 */
export function writeRecipeDefinitions({ home, rows }: { home: string; rows: readonly RecipeDefinition[] }): string {
  const directory = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(directory, { recursive: true });
  for (const definition of rows) {
    writeFileSync(join(directory, `${definition.recipeId}.json`), JSON.stringify(definition), "utf8");
  }
  return directory;
}

/**
 * Replace the run-stamps file with one successful run per named row, each at its own instant — which is
 * also the slot it covered.
 *
 * @param home the explicit temp home
 * @param stamps recipe id → the instant it last ran; a row left out has never run
 * @returns the run-stamps file
 */
export function stampRecipeRuns({ home, stamps }: { home: string; stamps: Readonly<Record<string, string>> }): string {
  const path = stateHomePaths({ home }).live.recipe.definitionRunsJson;
  mkdirSync(dirname(path), { recursive: true });
  const runs = Object.fromEntries(
    Object.entries(stamps).map(([recipeId, atIso]) => [
      recipeId,
      { exitCode: 0, lastRunAtIso: atIso, watermarkIso: atIso },
    ]),
  );
  writeFileSync(path, JSON.stringify({ runs, schemaVersion: RECIPE_DEFINITION_RUNS_SCHEMA_VERSION }), "utf8");
  return path;
}
