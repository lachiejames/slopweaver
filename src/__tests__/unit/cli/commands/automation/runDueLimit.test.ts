/**
 * `limitOutcome` — a tick's `--limit` judged before a firing is taken: no bound and room under it both answer
 * `null`, and a row past it is reported still due, unrun and unfailed.
 */
import { describe, expect, it } from "vitest";

import { limitOutcome } from "../../../../../cli/commands/automation/runDueLimit.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../../live/automation/definition.js";

const DEFINITION: RecipeDefinition = {
  cadence: "0 * * * *",
  destination: { kind: "local-atlas" },
  effect: "read",
  enabled: true,
  kind: "verb-run",
  onMissed: "skip",
  params: { argv: ["atlas", "freshness"] },
  recipeId: "atlas-rolling-window",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
};

describe("limitOutcome", () => {
  it("lets every row through with no bound", () => {
    expect(limitOutcome({ definition: DEFINITION, limit: null, started: 40 })).toBe(null);
  });

  it("lets a row through while the tick is under its bound", () => {
    expect(limitOutcome({ definition: DEFINITION, limit: 2, started: 1 })).toBe(null);
  });

  it("reports a row at the bound still due, unrun and unfailed", () => {
    expect(limitOutcome({ definition: DEFINITION, limit: 2, started: 2 })).toEqual({
      detail: [],
      exitCode: null,
      failed: false,
      line: "recipe atlas-rolling-window · still due · past this tick's --limit of 2",
      ran: false,
      recipeId: "atlas-rolling-window",
    });
  });
});
