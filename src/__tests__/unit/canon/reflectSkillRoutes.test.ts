/**
 * The witness that the self-improvement loop has a command surface, and that it stays the one a question
 * about the loop routes to.
 *
 * The owner believed the loop ran on the recipe scheduler and asked what it had found that day.
 * It had never been scheduled, and `slopweaver
 * reflect` had no `skills/reflect/SKILL.md`, so rule 4's command surface had nothing to load for that
 * question. This test ranks the REAL descriptions off disk with the SHIPPED ranker, the same way
 * `complianceSkillRoutes.test.ts` does, and on a `mkdtempSync` home for the reason that file states.
 *
 * The second half is a drift guard: the skill names every verb `reflectManifest` registers, so a verb added
 * to the noun without its skill line fails here rather than reading as documented.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLEAR_OWNER_SCORE } from "../../../admit/skillLoadGate.js";
import { reflectManifest } from "../../../cli/manifests/reflect.js";
import { availableSkills } from "../../../live/turn/skillCatalogue.js";
import { type CatalogueSkill, rankSkills } from "../../../live/turn/skillRouting.js";

/** The repository root, four levels above this file. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The owner's ask, as the handover that answered it records it. */
const RECORDED_QUESTION = "what did the self-improvement loop find today";

describe("the reflect skill owns a question about the self-improvement loop", () => {
  let catalogue: readonly CatalogueSkill[] = [];
  let home = "";

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "reflect-routes-"));
    catalogue = availableSkills({ home, repoRoot: REPO_ROOT });
  });

  afterAll(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a catalogue at all, so every assertion below is over a real registry", () => {
    expect(catalogue.length).toBeGreaterThan(0);
    expect(catalogue.map((skill) => skill.name)).toContain("reflect");
  });

  it("ranks reflect first on the recorded question, clear of the gate's floor", () => {
    const ranked = rankSkills({ limit: 1, question: RECORDED_QUESTION, skills: catalogue });
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.skill.name).toBe("reflect");
    expect(ranked[0]!.skill.path.endsWith("skills/reflect/SKILL.md")).toBe(true);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(CLEAR_OWNER_SCORE);
  });
});

describe("the reflect skill names every reflect verb", () => {
  const skill = readFileSync(join(REPO_ROOT, "skills", "reflect", "SKILL.md"), "utf8");
  const verbs = Object.keys(reflectManifest);

  it("reads a non-empty manifest, so the guard below is over a real registry", () => {
    expect(verbs.length).toBeGreaterThan(0);
  });

  it("carries a `slopweaver reflect <verb>` line for each one", () => {
    const unnamed = verbs.filter((verb) => !new RegExp(`slopweaver reflect ${verb}(?![\\w-])`).test(skill));
    expect(unnamed).toEqual([]);
  });
});
