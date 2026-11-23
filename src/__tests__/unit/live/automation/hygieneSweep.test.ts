/**
 * The `hygiene-sweep` kind's pure half — the read its row makes, and the check that decides whether what came
 * back is a packet worth publishing.
 */
import { describe, expect, it } from "vitest";

import { parseGithubLandingArgs } from "../../../../cli/commands/github/landingCore.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { HygieneSweepErrors, landingPacketOf, planHygieneSweep } from "../../../../live/automation/hygieneSweep.js";
import { findRecipeKind, HYGIENE_SWEEP_KIND } from "../../../../live/automation/kinds.js";

/** The `hygiene-sweep` standing row, parsed, overridable field by field. */
function definition(over: Partial<RecipeDefinition> = {}): RecipeDefinition {
  return {
    cadence: "15 7 * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    enabled: true,
    kind: HYGIENE_SWEEP_KIND,
    onMissed: "skip",
    params: {},
    recipeId: "hygiene-sweep",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

describe("planHygieneSweep", () => {
  it("resolves the fixed read with no --repo, so the landing's own default selects, the owner's own pull requests, drafts included", () => {
    expect(unwrap(planHygieneSweep({ definition: definition(), home: "/h" }))).toEqual({
      recipeId: "hygiene-sweep",
      rest: [
        "--author",
        "@me",
        "--include-drafts",
        "--slack-live",
        "--json",
        "--record-reading",
        "recipe:hygiene-sweep",
        "--home",
        "/h",
      ],
    });
  });

  it("hands the landing verb an argv its own parser accepts, and neither presses nor skips", () => {
    const { rest } = unwrap(planHygieneSweep({ definition: definition(), home: "/h" }));
    const args = unwrap(parseGithubLandingArgs({ rest }));
    expect(args.author).toBe("@me");
    expect(args.includeDrafts).toBe(true);
    expect(args.json).toBe(true);
    expect(args.press).toBe(false);
    expect(args.ifDue).toBe(false);
    expect(args.repos).toStrictEqual([]);
    expect(rest.includes("--register")).toBe(false);
  });

  it("refuses a row carrying any param, naming each one, so a row cannot widen the read", () => {
    const refused = planHygieneSweep({ definition: definition({ params: { repo: "x", author: "y" } }), home: "/h" });
    expect(unwrapErr(refused)).toEqual(
      HygieneSweepErrors.paramsPresent({ keys: ["author", "repo"], recipeId: "hygiene-sweep" }),
    );
    expect(unwrapErr(refused).message).toBe(
      "recipe hygiene-sweep: a hygiene-sweep row takes no params (found author, repo) — its read is fixed in " +
        "src/live/automation/hygieneSweep.ts so a row cannot widen it",
    );
  });
});

describe("landingPacketOf", () => {
  const READ = '{"kind":"read","rows":[],"dispatchable":[]}';

  it("answers the one read document as it was printed, never re-serialised", () => {
    const spaced = '{ "kind": "read", "rows": [], "dispatchable": [] }';
    expect(unwrap(landingPacketOf({ lines: [spaced], recipeId: "r" }))).toBe(spaced);
  });

  it("refuses no document and two documents alike, counting what it got", () => {
    expect(unwrapErr(landingPacketOf({ lines: [], recipeId: "r" })).code).toBe("PACKET_COUNT");
    expect(unwrapErr(landingPacketOf({ lines: [READ, READ], recipeId: "r" }))).toEqual(
      HygieneSweepErrors.packetCount({ count: 2, recipeId: "r" }),
    );
  });

  it("refuses text that is not JSON", () => {
    const refused = unwrapErr(landingPacketOf({ lines: ["landing: 3 rows"], recipeId: "r" }));
    expect(refused.code).toBe("PACKET_NOT_JSON");
    expect(refused.message).toContain("recipe r: github landing's document is not JSON — ");
  });

  it("refuses a skipped tick, which would replace a usable packet with one that says nothing", () => {
    const skipped = '{"kind":"skipped","rows":[],"dispatchable":[]}';
    expect(unwrapErr(landingPacketOf({ lines: [skipped], recipeId: "r" }))).toEqual(
      HygieneSweepErrors.packetNotRead({ recipeId: "r" }),
    );
  });

  it("refuses a read missing the rows a session works from", () => {
    expect(unwrapErr(landingPacketOf({ lines: ['{"kind":"read","rows":[]}'], recipeId: "r" })).code).toBe(
      "PACKET_NOT_READ",
    );
    expect(unwrapErr(landingPacketOf({ lines: ["[]"], recipeId: "r" })).code).toBe("PACKET_NOT_READ");
  });
});

describe("the hygiene-sweep kind", () => {
  it("is registered read-write, because the row records its reading into the local ledgers", () => {
    expect(findRecipeKind({ kind: HYGIENE_SWEEP_KIND })!.capability).toBe("read-write");
    expect(findRecipeKind({ kind: HYGIENE_SWEEP_KIND })!.briefingOnly).toBe(false);
  });
});
