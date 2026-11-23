/**
 * The witness for the catalogue hole behind a compliance-control question — the test that would have been
 * red.
 *
 * Prompt 1 of the weekend dogfood asked "what would it take to get our password policy control passing in
 * vanta" and the answer shipped with `grounding.provenance.skillsLoaded` EMPTY. The skill-load gate did not
 * fire and was right not to: ranking the catalogue against that question put the best candidate at 1.00,
 * under `CLEAR_OWNER_SCORE`. Nothing in the catalogue owned the subject, so `skills/compliance/SKILL.md` was
 * written — and this test is what stops its front matter drifting back under the floor, which is a silent
 * regression whose only symptom is a turn that loads nothing.
 *
 * It ranks the REAL descriptions off disk with the SHIPPED parser and ranker, against a catalogue built from
 * this repository's own `skills/` only. A `mkdtempSync` home rather than the ambient one is deliberate twice
 * over: `home-safety`'s `env-home-read` half refuses an ambient read anywhere under `src/__tests__/`, and a
 * catalogue that varied with whichever checkouts the operator has declared would score differently in CI
 * than in a seat — exactly the kind of number nobody can reproduce.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLEAR_OWNER_SCORE } from "../../../admit/skillLoadGate.js";
import { availableSkills } from "../../../live/turn/skillCatalogue.js";
import { type CatalogueSkill, rankSkills } from "../../../live/turn/skillRouting.js";

/** The repository root, four levels above this file. */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** The question as it was actually asked, verbatim from the dogfood packet. */
const RECORDED_QUESTION = "what would it take to get our password policy control passing in vanta";

describe("the compliance skill owns a compliance-control question", () => {
  let catalogue: readonly CatalogueSkill[] = [];
  let home = "";

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), "compliance-routes-"));
    catalogue = availableSkills({ home, repoRoot: REPO_ROOT });
  });

  afterAll(() => {
    rmSync(home, { force: true, recursive: true });
  });

  it("reads a catalogue at all, so every assertion below is over a real registry", () => {
    expect(catalogue.length).toBeGreaterThan(0);
    expect(catalogue.map((skill) => skill.name)).toContain("compliance");
  });

  it("ranks compliance first on the recorded question, clear of the gate's floor", () => {
    const ranked = rankSkills({ limit: 1, question: RECORDED_QUESTION, skills: catalogue });
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.skill.name).toBe("compliance");
    expect(ranked[0]!.skill.path.endsWith("skills/compliance/SKILL.md")).toBe(true);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(CLEAR_OWNER_SCORE);
  });

  it("ranks compliance first on the other shapes the same job arrives as", () => {
    const questions = [
      "why is the MFA control failing in vanta",
      "how far are we off the ISO 27001 fieldwork gate",
      "what evidence does that compliance control need",
    ];
    const winners = questions.map((question) => rankSkills({ limit: 1, question, skills: catalogue })[0]!.skill.name);
    expect(winners).toEqual(["compliance", "compliance", "compliance"]);
  });

  it("scores nothing at all on a question outside the job, so the description is not a catch-all", () => {
    const questions = [
      "why did the staging connection pool exhaust last night",
      "raise a fix pr for that dependabot critical",
      "what is on my calendar tomorrow",
    ];
    const ranked = questions.map((question) => rankSkills({ limit: 50, question, skills: catalogue }));
    // Each question DOES match something, so the empty compliance rows below are the ranker excluding it
    // rather than the ranker returning nothing at all — and the catalogue carries the entry, asserted above.
    expect(ranked.map((rows) => rows.length > 0)).toEqual([true, true, true]);
    expect(ranked.map((rows) => rows.filter((row) => row.skill.name === "compliance"))).toEqual([[], [], []]);
  });
});
