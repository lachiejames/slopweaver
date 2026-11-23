/**
 * `planVerbRun` — the `verb-run` kind's executor, which every verb-run row is planned by.
 *
 * The two checks that matter are both here: a row may only name a verb this build ROUTES, and a row may not
 * declare a narrower effect than the verb it selects. Both are pure, so the real registry is the fixture.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { planVerbRun, verbRunArgv } from "../../../../live/automation/verbRun.js";

/** A `verb-run` row selecting `atlas freshness`, overridable field by field. */
function row(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    enabled: true,
    kind: "verb-run",
    onMissed: "backfill",
    params: { argv: ["atlas", "freshness", "--behind-only"] },
    recipeId: "atlas-rolling-window",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

describe("planVerbRun", () => {
  it("plans a row naming a routed verb whose effect the row covers", () => {
    const plan = unwrap(planVerbRun({ definition: row() }));
    expect(plan.noun).toBe("atlas");
    expect(plan.verb).toBe("freshness");
    expect(plan.argv).toEqual(["atlas", "freshness", "--behind-only"]);
    expect(plan.verbEffect).toBe("none");
  });

  it("refuses params that are not a verb-run configuration", () => {
    const error = unwrapErr(planVerbRun({ definition: row({ params: { command: "atlas freshness" } }) }));
    expect(error.code).toBe("PARAMS_INVALID");
    expect(error.message).toContain("is not a runnable verb-run row");
  });

  it("refuses an argv too short to name a noun and a verb", () => {
    const error = unwrapErr(planVerbRun({ definition: row({ params: { argv: ["atlas"] } }) }));
    expect(error.code).toBe("PARAMS_INVALID");
  });

  it("refuses a verb this build does not route", () => {
    const error = unwrapErr(planVerbRun({ definition: row({ params: { argv: ["rm", "-rf"] } }) }));
    expect(error.code).toBe("UNKNOWN_VERB");
    expect(error.message).toContain("does not route as a slopweaver verb");
  });

  it("refuses a read-only row that selects a verb which writes externally", () => {
    const error = unwrapErr(
      planVerbRun({ definition: row({ effect: "read", params: { argv: ["slack", "post", "--dry-run"] } }) }),
    );
    expect(error.code).toBe("EFFECT_EXCEEDS_ROW");
    expect(error.message).toContain("never less");
  });

  it("accepts a read-write row selecting the same writing verb", () => {
    const plan = unwrap(
      planVerbRun({ definition: row({ effect: "read-write", params: { argv: ["slack", "post", "--dry-run"] } }) }),
    );
    expect(plan.verbEffect).toBe("external-write");
  });

  it("accepts a row declaring MORE than the verb it runs needs", () => {
    const plan = unwrap(planVerbRun({ definition: row({ effect: "read-write" }) }));
    expect(plan.verb).toBe("freshness");
  });
});

describe("verbRunArgv", () => {
  it("puts the row's words where the dispatcher reads a noun and a verb", () => {
    const plan = unwrap(planVerbRun({ definition: row() }));
    const argv = verbRunArgv({ plan });
    expect(argv[2]).toBe("atlas");
    expect(argv[3]).toBe("freshness");
    expect(argv).toEqual(["node", "slopweaver", "atlas", "freshness", "--behind-only"]);
  });
});
