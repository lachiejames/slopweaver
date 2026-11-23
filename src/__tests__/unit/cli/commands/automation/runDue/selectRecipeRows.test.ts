/**
 * `selectRecipeRows` — the pure half of `automation run-due --recipe <id>`, which narrows the parsed store to the
 * named row without reordering it.
 */
import { describe, expect, it } from "vitest";

import { selectRecipeRows } from "../../../../../../cli/commands/automation/runDueSelection.js";
import {
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
} from "../../../../../../live/automation/definition.js";

describe("selectRecipeRows", () => {
  /** One parsed row, as the store hands them back, carrying only what the selector reads. */
  function parsed({ recipeId }: { recipeId: string }): RecipeDefinition {
    return {
      cadence: "0 * * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: "verb-run",
      onMissed: "skip",
      params: { argv: ["atlas", "freshness"] },
      recipeId,
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    };
  }

  it("hands back every row untouched when no id was named", () => {
    const rows = [parsed({ recipeId: "a" }), parsed({ recipeId: "b" })];
    const selection = selectRecipeRows({ definitions: rows, recipeId: null });
    expect(selection.definitions.map((entry) => entry.recipeId)).toEqual(["a", "b"]);
    expect(selection.unknownRecipeId).toBe(null);
  });

  it("keeps only the named row, whatever its position in store order", () => {
    const rows = [parsed({ recipeId: "a" }), parsed({ recipeId: "b" }), parsed({ recipeId: "c" })];
    const selection = selectRecipeRows({ definitions: rows, recipeId: "c" });
    expect(selection.definitions.map((entry) => entry.recipeId)).toEqual(["c"]);
    expect(selection.unknownRecipeId).toBe(null);
  });

  it("reports the unmatched id and selects nothing when the store carries no such row", () => {
    const selection = selectRecipeRows({ definitions: [parsed({ recipeId: "a" })], recipeId: "z" });
    expect(selection.definitions).toEqual([]);
    expect(selection.unknownRecipeId).toBe("z");
  });

  it("selects BOTH halves of a duplicated id, exactly as an un-narrowed tick would", () => {
    const rows = [parsed({ recipeId: "a" }), parsed({ recipeId: "a" })];
    const selection = selectRecipeRows({ definitions: rows, recipeId: "a" });
    expect(selection.definitions.length).toBe(2);
    expect(selection.unknownRecipeId).toBe(null);
  });

  it("reports an unmatched id rather than an empty selection when the store itself is empty", () => {
    const selection = selectRecipeRows({ definitions: [], recipeId: "a" });
    expect(selection.definitions).toEqual([]);
    expect(selection.unknownRecipeId).toBe("a");
  });
});
