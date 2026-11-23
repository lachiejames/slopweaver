/**
 * `recipeTreeEscape` over a throwaway home: a plain layout passes, a written directory linked anywhere — another
 * home, or nowhere at all — refuses before anything is written. The verb-level proof that nothing in the other home
 * changes is `retire.test.ts`.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { recipeTreeEscape } from "../../../../../cli/commands/automation/retireHomeCheck.js";
import { stateHomePaths } from "../../../../../stateHome.js";

let home = "";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "retire-home-"));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

describe("recipeTreeEscape", () => {
  it("passes a home whose written directories do not exist yet", () => {
    expect(recipeTreeEscape({ home })).toBe(null);
  });

  it("passes a home whose written directories exist in place", () => {
    mkdirSync(stateHomePaths({ home }).live.recipe.definitionsDir, { recursive: true });

    expect(recipeTreeEscape({ home })).toBe(null);
  });

  it("refuses a definitions directory linked into another directory, naming where it resolves", () => {
    const other = mkdtempSync(join(tmpdir(), "retire-home-other-"));
    try {
      const definitions = stateHomePaths({ home }).live.recipe.definitionsDir;
      mkdirSync(dirname(definitions), { recursive: true });
      symlinkSync(other, definitions);

      expect(recipeTreeEscape({ home })).toContain(`${definitions} resolves to `);
      expect(recipeTreeEscape({ home })).toContain("not its own place in this home — nothing changed");
    } finally {
      rmSync(other, { force: true, recursive: true });
    }
  });

  it("refuses a dangling link where a written directory goes", () => {
    const definitions = stateHomePaths({ home }).live.recipe.definitionsDir;
    mkdirSync(dirname(definitions), { recursive: true });
    symlinkSync(join(home, "nowhere"), definitions);

    expect(recipeTreeEscape({ home })).toBe(`${definitions} exists but does not resolve — nothing changed`);
  });
});
