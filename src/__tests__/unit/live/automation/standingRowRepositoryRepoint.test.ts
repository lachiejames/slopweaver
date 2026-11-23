/**
 * The pure half of `automation repoint`: which drifted own-repository row it moves, the exact bytes it writes, and
 * every row it refuses. The shared `--repo` reader both it and the drift report ask is pinned here too.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { parseRecipeDefinition, type RecipeDefinition } from "../../../../live/automation/definition.js";
import { namedRepository, repositoryArgvOccurrences } from "../../../../live/automation/repositoryArgv.js";
import {
  BUMP_DRIVE_OWN_RECIPE_ID,
  BUMP_FIX_OWN_RECIPE_ID,
  ownRepositoryStandingRows,
} from "../../../../live/automation/standingOwnRepositoryRows.js";
import { planRepoint, repointLine } from "../../../../live/automation/standingRowRepositoryRepoint.js";

/** The declaration on the resolved address, with one earlier address a pass once wrote. */
const DECLARED = ownRepositoryStandingRows({
  repository: "acme/slopweaver",
  supersededRepositories: ["acme-old/slopweaver"],
});

/** The declared drive row's definition. */
const DRIVE = DECLARED[0]!.definition;

/** A stored row as the store parses its file's text. */
function parsed({ text }: { readonly text: string }): RecipeDefinition {
  return unwrap(parseRecipeDefinition({ value: JSON.parse(text) as unknown }));
}

/** The drive row turned off and on another repository, as this install held it, in the given argv. */
function driftedText({ argv }: { readonly argv: readonly string[] }): string {
  return JSON.stringify({ ...DRIVE, enabled: false, params: { argv } });
}

/** Plan one repoint of the drive row over a store holding exactly this text in its canonical file. */
function planDrive({ text, files }: { readonly text: string; readonly files?: readonly string[] }) {
  let definitionFiles: readonly string[] = [`${BUMP_DRIVE_OWN_RECIPE_ID}.json`];
  if (files !== undefined) {
    definitionFiles = files;
  }
  return planRepoint({
    declared: DECLARED,
    definitionFiles,
    definitions: definitionFiles.map(() => parsed({ text })),
    rawText: text,
    recipeId: BUMP_DRIVE_OWN_RECIPE_ID,
  });
}

describe("repositoryArgvOccurrences", () => {
  it("reads both spellings in argv order, and nothing from a bare trailing flag or a non-array", () => {
    expect(repositoryArgvOccurrences({ argv: ["x", "--repo", "a/b", "--repo=c/d", "--repo"] })).toEqual([
      { index: 2, repository: "a/b", spelling: "spaced" },
      { index: 3, repository: "c/d", spelling: "inline" },
    ]);
    expect(repositoryArgvOccurrences({ argv: "--repo a/b" })).toEqual([]);
  });

  it("names the first spaced repository before any inline one, and nothing when there is none", () => {
    expect(namedRepository({ argv: ["--repo=c/d", "--repo", "a/b"] })).toBe("a/b");
    expect(namedRepository({ argv: ["--repo=c/d"] })).toBe("c/d");
    expect(namedRepository({ argv: ["github", "bump-drive"] })).toBe(undefined);
  });
});

describe("planRepoint", () => {
  it("moves the one --repo to the declared repository and keeps enabled false and every other field", () => {
    const text = driftedText({ argv: ["github", "bump-drive", "--repo", "someone/slopweaver"] });
    const plan = unwrap(planDrive({ text }));
    expect(plan.beforeRepository).toBe("someone/slopweaver");
    expect(plan.afterRepository).toBe("acme/slopweaver");
    expect(plan.file).toBe("bump-drive-slopweaver.json");
    expect(plan.contents).toBe(
      `${JSON.stringify({ ...DRIVE, enabled: false, params: { argv: ["github", "bump-drive", "--repo", "acme/slopweaver"] } })}\n`,
    );
    expect(repointLine({ dryRun: true, plan })).toBe(
      "automation repoint · WOULD REPOINT bump-drive-slopweaver · `someone/slopweaver` → `acme/slopweaver` in " +
        "bump-drive-slopweaver.json, every other field kept",
    );
    expect(repointLine({ dryRun: false, plan }).split(" · ")[1]).toBe("REPOINTED bump-drive-slopweaver");
  });

  it("keeps an inline spelling inline, and keys the file carries that the definition does not", () => {
    const text = JSON.stringify({
      ...DRIVE,
      enabled: false,
      manualNote: "turned off on this install",
      params: { argv: ["github", "bump-drive", "--repo=someone/slopweaver"] },
    });
    const written = JSON.parse(unwrap(planDrive({ text })).contents) as Record<string, unknown>;
    expect(written["params"]).toEqual({ argv: ["github", "bump-drive", "--repo=acme/slopweaver"] });
    expect(written["manualNote"]).toBe("turned off on this install");
    expect(written["enabled"]).toBe(false);
  });

  it("refuses a row on the declared repository, and one in an earlier build's shape, as not drift", () => {
    const current = JSON.stringify({ ...DRIVE, enabled: false });
    expect(unwrapErr(planDrive({ text: current })).code).toBe("NOT_DRIFTED");
    const earlier = JSON.stringify(DECLARED[0]!.supersedes![0]);
    expect(unwrapErr(planDrive({ text: earlier })).message).toBe(
      "bump-drive-slopweaver is not REPOSITORY DRIFT: it is on the declared repository, or in an earlier build's " +
        "shape, which `slopweaver automation register-standing` brings forward",
    );
  });

  it("refuses an argv naming --repo twice, or not at all", () => {
    const twice = driftedText({ argv: ["github", "bump-drive", "--repo", "someone/slopweaver", "--repo=x/y"] });
    expect(unwrapErr(planDrive({ text: twice })).message).toBe(
      "bump-drive-slopweaver's argv names 2 `--repo` flags, not one, so no single value is the row's to move",
    );
    const none = driftedText({ argv: ["github", "bump-drive"] });
    expect(unwrapErr(planDrive({ text: none })).code).toBe("REPO_FLAG_UNCLEAR");
  });

  it("refuses a row standing in two files or under another name", () => {
    const text = driftedText({ argv: ["github", "bump-drive", "--repo", "someone/slopweaver"] });
    expect(unwrapErr(planDrive({ files: ["bump-drive-slopweaver.json", "copy.json"], text })).message).toBe(
      "bump-drive-slopweaver stands in bump-drive-slopweaver.json, copy.json, not in bump-drive-slopweaver.json " +
        "alone — remove every other copy first",
    );
    expect(unwrapErr(planDrive({ files: ["daily.json"], text })).code).toBe("FILES_AMBIGUOUS");
  });

  it("refuses when the file's text is no longer the row the store read", () => {
    const text = driftedText({ argv: ["github", "bump-drive", "--repo", "someone/slopweaver"] });
    const plan = planRepoint({
      declared: DECLARED,
      definitionFiles: ["bump-drive-slopweaver.json"],
      definitions: [parsed({ text })],
      rawText: "",
      recipeId: BUMP_DRIVE_OWN_RECIPE_ID,
    });
    expect(unwrapErr(plan).code).toBe("FILE_CHANGED");
  });

  it("refuses an id that is not a declared own-repository row, and a declared one the store does not hold", () => {
    const notOwn = planRepoint({
      declared: DECLARED,
      definitionFiles: [],
      definitions: [],
      rawText: "",
      recipeId: "worktree-prune",
    });
    expect(unwrapErr(notOwn).code).toBe("NOT_OWN_ROW");
    const absent = planRepoint({
      declared: DECLARED,
      definitionFiles: [],
      definitions: [],
      rawText: "",
      recipeId: BUMP_FIX_OWN_RECIPE_ID,
    });
    expect(unwrapErr(absent).message).toBe(
      "the store holds no bump-fix-slopweaver row — `slopweaver automation register-standing` writes the declared one",
    );
  });
});
