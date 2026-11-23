/**
 * Which remembered resync states a monitor judges: the rows that still exist, failing open. Pure membership cases, then
 * one round-trip over real temp directories — never a mocked filesystem.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  parseRecipeDefinition,
  RECIPE_DEFINITION_SCHEMA_VERSION,
  type RecipeDefinition,
} from "../../../../live/automation/definition.js";
import { isLiveRecipe, readActiveResyncStates } from "../../../../live/resync/activeState.js";
import type { ResyncState } from "../../../../live/resync/outcome.js";
import { writeResyncState } from "../../../../live/resync/outcomeStore.js";

const row = ({ recipeId }: { readonly recipeId: string }): Record<string, unknown> => ({
  cadence: "0 10 * * 1-5",
  destination: { kind: "slack" },
  effect: "read-write",
  kind: "alert-summary",
  params: {},
  recipeId,
  schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
});

const definition = ({ recipeId }: { readonly recipeId: string }): RecipeDefinition =>
  unwrap(parseRecipeDefinition({ value: row({ recipeId }) }));

const walled = ({ recipeId }: { readonly recipeId: string }): ResyncState => ({
  blocker: null,
  lastAttempt: {
    afterClock: null,
    beforeClock: null,
    exitCode: 4,
    finishedAtIso: "2026-10-08T00:01:00.000Z",
    outcome: "failed",
    problems: [],
    recipeId,
    signInWall: "https://go.xero.com",
    startedAtIso: "2026-10-08T00:00:00.000Z",
  },
  lastSuccessAtIso: null,
  recipeId,
});

describe("isLiveRecipe", () => {
  const live = [definition({ recipeId: "resync-atlas-trelica" })];

  it("keeps a row a parsed definition names, whatever file it sits in", () => {
    expect(
      isLiveRecipe({
        definitions: live,
        directoryUnreadable: false,
        recipeId: "resync-atlas-trelica",
        rejectedFiles: [],
      }),
    ).toBe(true);
  });

  it("drops a row no definition names — a retired row", () => {
    expect(
      isLiveRecipe({ definitions: live, directoryUnreadable: false, recipeId: "resync-atlas-xero", rejectedFiles: [] }),
    ).toBe(false);
  });

  it("keeps every row while any definition file would not parse, whatever that file is named", () => {
    expect(
      isLiveRecipe({
        definitions: live,
        directoryUnreadable: false,
        recipeId: "resync-atlas-xero",
        rejectedFiles: ["zz-copy.json"],
      }),
    ).toBe(true);
  });

  it("keeps every row when the definitions directory would not list", () => {
    expect(
      isLiveRecipe({ definitions: [], directoryUnreadable: true, recipeId: "resync-atlas-xero", rejectedFiles: [] }),
    ).toBe(true);
  });
});

describe("readActiveResyncStates", () => {
  let root = "";
  let stateDir = "";
  let definitionsDir = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "active-state-"));
    stateDir = join(root, "resync-state");
    definitionsDir = join(root, "definitions");
    mkdirSync(stateDir, { recursive: true });
    mkdirSync(definitionsDir, { recursive: true });
    unwrap(writeResyncState({ state: walled({ recipeId: "resync-atlas-trelica" }), stateDir }));
    unwrap(writeResyncState({ state: walled({ recipeId: "resync-atlas-xero" }), stateDir }));
    writeFileSync(
      join(definitionsDir, "resync-atlas-trelica.json"),
      JSON.stringify(row({ recipeId: "resync-atlas-trelica" })),
    );
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  it("reads the states of rows that still exist and leaves a retired row's last wall behind", () => {
    const read = readActiveResyncStates({ definitionsDir, stateDir });

    expect([...read.states.keys()]).toEqual(["resync-atlas-trelica"]);
    expect(read.definitionProblem).toBe(null);
    expect(read.isLive({ recipeId: "resync-atlas-xero" })).toBe(false);
  });

  it("keeps every state, and names the file, when a misnamed definition would not parse", () => {
    writeFileSync(join(definitionsDir, "zz-copy.json"), JSON.stringify({ recipeId: "resync-atlas-xero" }));

    const read = readActiveResyncStates({ definitionsDir, stateDir });

    expect([...read.states.keys()].toSorted()).toEqual(["resync-atlas-trelica", "resync-atlas-xero"]);
    expect(read.definitionProblem).toBe(
      "the recipe definition file(s) zz-copy.json would not parse and may name any row",
    );
  });

  it("keeps every state, and says why, when the definitions directory is not there at all", () => {
    const absent = join(root, "never-created");

    const read = readActiveResyncStates({ definitionsDir: absent, stateDir });

    expect([...read.states.keys()].toSorted()).toEqual(["resync-atlas-trelica", "resync-atlas-xero"]);
    expect(read.definitionProblem).toBe(`the recipe definitions directory ${absent} is not there`);
  });

  it("keeps every state, and says why, when the definitions path will not list", () => {
    const notADirectory = join(root, "a-file");
    writeFileSync(notADirectory, "not a directory");

    const read = readActiveResyncStates({ definitionsDir: notADirectory, stateDir });

    expect([...read.states.keys()].toSorted()).toEqual(["resync-atlas-trelica", "resync-atlas-xero"]);
    expect(read.definitionProblem).toContain("could not be listed");
    expect(read.isLive({ recipeId: "resync-atlas-xero" })).toBe(true);
  });
});
