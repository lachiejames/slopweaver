/**
 * `loadRecipeDefinitions` over a real temp directory — a genuine round-trip fixture, never a mocked
 * filesystem. Everything is written under an explicit `mkdtempSync` root and removed in `afterEach`, so
 * nothing touches the ambient home.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { err, ok } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { loadRecipeDefinitions, withoutRetiredRows } from "../../../../live/automation/definitionStore.js";
import { AutomationRetirementStoreErrors } from "../../../../live/automation/retirementStore.js";

let root = "";
let directory = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "recipe-defs-"));
  directory = join(root, "definitions");
  mkdirSync(directory, { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function write({ name, body }: { readonly name: string; readonly body: unknown }): void {
  writeFileSync(join(directory, name), typeof body === "string" ? body : JSON.stringify(body), "utf8");
}

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  cadence: "0 10 * * 1-5",
  destination: { kind: "slack" },
  effect: "read-write",
  kind: "alert-summary",
  params: {},
  recipeId: "knock-alerts",
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  ...over,
});

describe("loadRecipeDefinitions", () => {
  it("reads a directory of definitions in name order", () => {
    write({ body: row({ recipeId: "b-recipe" }), name: "b.json" });
    write({ body: row({ recipeId: "a-recipe" }), name: "a.json" });

    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions.map((d) => d.recipeId)).toEqual(["a-recipe", "b-recipe"]);
    expect(roster.rejected).toEqual([]);
  });

  it("answers an empty roster for a directory that is not there, because no recipes is the ordinary state", () => {
    const roster = loadRecipeDefinitions({ board: null, directory: join(root, "never-created") });

    expect(roster.definitions).toEqual([]);
    expect(roster.rejected).toEqual([]);
    expect(roster.directoryError).toBe(null);
  });

  it("says why when the path is there but will not list, rather than answering an empty roster", () => {
    const notADirectory = join(root, "a-file");
    writeFileSync(notADirectory, "not a directory", "utf8");

    const roster = loadRecipeDefinitions({ board: null, directory: notADirectory });

    expect(roster.definitions).toEqual([]);
    expect(roster.directoryError).toContain(`the recipe definitions directory ${notADirectory} could not be listed`);
  });

  it("answers an empty roster for an empty directory", () => {
    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions).toEqual([]);
    expect(roster.rejected).toEqual([]);
  });

  it("keeps every good row when one file is invalid JSON", () => {
    write({ body: row({ recipeId: "good-one" }), name: "a-good.json" });
    write({ body: "{ this is not json", name: "b-broken.json" });
    write({ body: row({ recipeId: "good-two" }), name: "c-good.json" });

    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions.map((d) => d.recipeId)).toEqual(["good-one", "good-two"]);
    expect(roster.rejected.map((r) => r.file)).toEqual(["b-broken.json"]);
    expect(roster.rejected[0]!.error.code).toBe("MALFORMED_DEFINITION");
  });

  it("keeps every good row when one names an unregistered kind", () => {
    write({ body: row({ kind: "exfiltrate", recipeId: "bad" }), name: "a-bad.json" });
    write({ body: row({ recipeId: "fine" }), name: "b-fine.json" });

    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions.map((d) => d.recipeId)).toEqual(["fine"]);
    expect(roster.rejected[0]!.error.code).toBe("UNKNOWN_KIND");
    expect(roster.rejected[0]!.file).toBe("a-bad.json");
  });

  it("rejects a row claiming more effect than its kind allows, and still loads the rest", () => {
    write({ body: row({ effect: "write", kind: "investigate", recipeId: "overreach" }), name: "a.json" });
    write({ body: row({ recipeId: "ok" }), name: "b.json" });

    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions.map((d) => d.recipeId)).toEqual(["ok"]);
    expect(roster.rejected[0]!.error.code).toBe("EFFECT_EXCEEDS_KIND");
  });

  it("ignores files that are not .json", () => {
    write({ body: row({ recipeId: "counted" }), name: "a.json" });
    write({ body: "notes about the schedule", name: "README.md" });

    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions.map((d) => d.recipeId)).toEqual(["counted"]);
    expect(roster.rejected).toEqual([]);
  });

  it("resolves onMissed on the way through, per destination", () => {
    write({ body: row({ recipeId: "slack-one" }), name: "a.json" });
    write({
      body: row({ destination: { kind: "datadog-push" }, kind: "metrics-push", recipeId: "push-one" }),
      name: "b.json",
    });

    const roster = loadRecipeDefinitions({ board: null, directory });

    expect(roster.definitions.map((d) => d.onMissed)).toEqual(["skip", "backfill"]);
  });
});

describe("withoutRetiredRows", () => {
  const retirement = {
    anchor: "talk:acme-turn",
    recipeId: "b-recipe",
    retiredAtIso: "2026-11-03T08:00:00.000Z",
    why: "not this install's",
    words: "turn it off",
  };

  it("takes a retired row's surviving file out of the runnable rows and rejects it, naming the repeat that removes it", () => {
    write({ body: row({ recipeId: "a-recipe" }), name: "a-recipe.json" });
    write({ body: row({ recipeId: "b-recipe" }), name: "b-recipe.json" });

    const roster = withoutRetiredRows({
      retirements: ok({ kind: "present", retirements: [retirement] }),
      roster: loadRecipeDefinitions({ board: null, directory }),
    });

    expect(roster.definitions.map((d) => d.recipeId)).toEqual(["a-recipe"]);
    expect(roster.definitionFiles).toEqual(["a-recipe.json"]);
    expect(roster.rejected.map((r) => r.file)).toEqual(["b-recipe.json"]);
    expect(roster.rejected[0]!.error.message).toContain(
      "b-recipe is retired on this install, so this file is never fired — `slopweaver automation retire b-recipe` again removes it",
    );
  });

  it("fires nothing when the registry will not read, rejecting every row", () => {
    write({ body: row({ recipeId: "a-recipe" }), name: "a-recipe.json" });

    const roster = withoutRetiredRows({
      retirements: err(AutomationRetirementStoreErrors.malformed({ issues: ["bad"], path: "/h/retirements.json" })),
      roster: loadRecipeDefinitions({ board: null, directory }),
    });

    expect(roster.definitions).toEqual([]);
    expect(roster.rejected.map((r) => r.file)).toEqual(["a-recipe.json"]);
    expect(roster.rejected[0]!.error.message).toContain("not fired — the automation retirement registry at");
  });

  it("leaves the roster whole with nothing retired", () => {
    write({ body: row({ recipeId: "a-recipe" }), name: "a-recipe.json" });
    const read = loadRecipeDefinitions({ board: null, directory });

    const roster = withoutRetiredRows({ retirements: ok({ kind: "absent", retirements: [] }), roster: read });

    expect(roster).toEqual(read);
  });
});
