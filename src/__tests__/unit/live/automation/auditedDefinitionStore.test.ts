/**
 * The audited view over a real definitions directory: it derives who placed each owner hold, reads each anchor
 * once, and never writes the derivation back. A `mkdtempSync` home, an injected resolver, no ambient state.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ok } from "#lib/result.js";

import type { RawWords } from "../../../../handover/hisWordsResolve.js";
import { loadAuditedRecipeDefinitions } from "../../../../live/automation/auditedDefinitionStore.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { ownerHoldPlacedByStateOf, type ResolveOwnerWords } from "../../../../live/automation/ownerHoldPlacedBy.js";
import { stateHomePaths } from "../../../../stateHome.js";

const ANCHOR = "talk-call:a0000048-0000-4000-8000-000000000051#turn_000000000000000000025";

let home: string;
let directory: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "audited-defs-"));
  directory = stateHomePaths({ home }).live.recipe.definitionsDir;
  mkdirSync(directory, { recursive: true });
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** One held verb-run row's file body. */
function heldBody({ recipeId }: { recipeId: string }): Record<string, unknown> {
  return {
    cadence: "0 2 * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    hold: {
      askedIso: "2026-10-19T11:48:00.000Z",
      clearedBy: null,
      placedBy: { anchor: ANCHOR, words: `pause ${recipeId}` },
      reason: "the owner's pause",
    },
    kind: "verb-run",
    params: { argv: ["atlas", "freshness"] },
    recipeId,
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
  };
}

describe("loadAuditedRecipeDefinitions", () => {
  it("derives each owner hold's state, reads a shared anchor once, and leaves the files as written", () => {
    const path = join(directory, "a.json");
    const stored = `${JSON.stringify(heldBody({ recipeId: "row-a" }))}\n`;
    writeFileSync(path, stored);
    writeFileSync(join(directory, "b.json"), `${JSON.stringify(heldBody({ recipeId: "row-b" }))}\n`);
    const asked: string[] = [];
    const resolveOwnerWords: ResolveOwnerWords = ({ anchor }) => {
      asked.push(anchor);
      const words: RawWords = {
        atIso: "2026-10-19T11:48:00.000Z",
        context: { kind: "call-segment", open: undefined },
        headKnown: true,
        headLost: false,
        tailKnown: true,
        tailLost: false,
        text: "please pause row-a tonight",
        where: "call",
      };
      return ok(words);
    };

    const roster = loadAuditedRecipeDefinitions({ home, resolveOwnerWords });

    const states = roster.definitions.map((definition) => [
      definition.recipeId,
      ownerHoldPlacedByStateOf({ definition: { ...definition, hold: definition.hold! } }),
    ]);

    expect(states).toEqual([
      ["row-a", { kind: "anchored" }],
      ["row-b", { kind: "unresolved", reason: `the words on the hold are not in the owner's record at ${ANCHOR}` }],
    ]);
    expect(asked).toEqual([ANCHOR]);
    expect(readFileSync(path, "utf8")).toBe(stored);
  });
});
