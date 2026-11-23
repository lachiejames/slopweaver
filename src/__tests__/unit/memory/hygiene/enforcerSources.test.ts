/**
 * THE EFFECTFUL HALF OF CHECK 5 — reading a repository's enforcers off disk.
 *
 * `classifyRule` is the whole distinction the check rests on, so it gets the frontmatter edges: a `paths:` in the
 * BODY is prose about scoping rather than scoping, and misreading it would misclassify the rule documenting the
 * convention. The rest is a round trip over a synthetic repository in a throwaway directory — a genuine fixture,
 * which `.claude/rules/testing.md` allows, rather than a mock of the filesystem.
 *
 * Everything here is invented. This is a public repository, and a fixture is the easiest place for a private
 * string to arrive unnoticed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  classifyRule,
  ROOT_ALWAYS_ON_DOCS,
  readEnforcers,
  SKILL_HEAD_LINES,
} from "../../../../memory/hygiene/enforcerSources.js";

describe("classifyRule", () => {
  it("calls a rule with a `paths:` frontmatter key scoped", () => {
    expect(classifyRule({ text: "---\npaths:\n  - src/cli/**\n---\n\nA rule.\n" })).toBe("scoped-rule");
  });

  it("calls a rule with frontmatter but no `paths:` always-on", () => {
    expect(classifyRule({ text: "---\ndescription: a rule\n---\n\nA rule.\n" })).toBe("always-on-doc");
  });

  it("calls a rule with no frontmatter at all always-on", () => {
    expect(classifyRule({ text: "# A rule\n\nAlways.\n" })).toBe("always-on-doc");
  });

  it("reads only the LEADING block, so a `paths:` written in prose does not scope the rule", () => {
    expect(classifyRule({ text: "# The directory axis\n\npaths: is how a rule is scoped.\n" })).toBe("always-on-doc");
    expect(classifyRule({ text: "---\ndescription: a rule\n---\n\npaths: is how scoping works.\n" })).toBe(
      "always-on-doc",
    );
  });

  it("calls an unterminated frontmatter block always-on rather than guessing at its keys", () => {
    expect(classifyRule({ text: "---\npaths:\n  - src/cli/**\n" })).toBe("always-on-doc");
  });
});

describe("readEnforcers", () => {
  let repo = "";

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "hygiene-enforcers-"));
  });

  afterEach(() => {
    rmSync(repo, { force: true, recursive: true });
  });

  it("reads the root docs, both kinds of rule, and each skill's head", () => {
    writeFileSync(join(repo, "AGENTS.md"), "# Working here\n\nBatch the pelicans.\n", "utf8");
    mkdirSync(join(repo, ".claude", "rules"), { recursive: true });
    writeFileSync(join(repo, ".claude", "rules", "testing.md"), "# Testing\n\nNo mocks.\n", "utf8");
    writeFileSync(
      join(repo, ".claude", "rules", "area-cli.md"),
      "---\npaths:\n  - src/cli/**\n---\n\nVerbs.\n",
      "utf8",
    );
    writeFileSync(join(repo, ".claude", "rules", "notes.txt"), "not a rule", "utf8");
    mkdirSync(join(repo, "skills", "pelican"), { recursive: true });
    writeFileSync(join(repo, "skills", "pelican", "SKILL.md"), "# pelican\n\nMigrate them.\n", "utf8");
    mkdirSync(join(repo, "skills", "skill-less"), { recursive: true });

    const enforcers = unwrap(readEnforcers({ repo }));
    const named = enforcers.filter((enforcer) => enforcer.kind !== "lint-gate");
    expect(named.map((enforcer) => [enforcer.id, enforcer.kind])).toEqual([
      ["AGENTS.md", "always-on-doc"],
      [join(".claude", "rules", "area-cli.md"), "scoped-rule"],
      [join(".claude", "rules", "testing.md"), "always-on-doc"],
      ["skills/pelican", "skill"],
    ]);
    expect(named[0]!.text).toContain("Batch the pelicans.");
  });

  it("reads every declared lint gate as its own enforcer", () => {
    const gates = unwrap(readEnforcers({ repo })).filter((enforcer) => enforcer.kind === "lint-gate");
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.filter((gate) => gate.text.trim().length === 0)).toEqual([]);
  });

  it("reads a repository holding none of the optional docs as gates alone", () => {
    const enforcers = unwrap(readEnforcers({ repo }));
    expect(enforcers.filter((enforcer) => enforcer.kind !== "lint-gate")).toEqual([]);
    expect(ROOT_ALWAYS_ON_DOCS.length).toBeGreaterThan(0);
  });

  it("reads only a skill's head, so a long procedure cannot pair every memory with every skill", () => {
    mkdirSync(join(repo, "skills", "long"), { recursive: true });
    const body = Array.from({ length: SKILL_HEAD_LINES + 20 }, (_unused, position) => `line${String(position)}`);
    writeFileSync(join(repo, "skills", "long", "SKILL.md"), `${body.join("\n")}\n`, "utf8");
    const skill = unwrap(readEnforcers({ repo })).find((enforcer) => enforcer.id === "skills/long")!;
    expect(skill.text.split("\n").length).toBe(SKILL_HEAD_LINES);
    expect(skill.text).toContain(`line${String(SKILL_HEAD_LINES - 1)}`);
    expect(skill.text).not.toContain(`line${String(SKILL_HEAD_LINES)}\n`);
  });

  it("refuses a repository root that is a file rather than a directory", () => {
    const file = join(repo, "AGENTS.md");
    writeFileSync(file, "# Working here\n", "utf8");
    const read = readEnforcers({ repo: file });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr()[0]).toContain("--repo must name a directory");
  });

  it("refuses a repository root that is not there at all", () => {
    const read = readEnforcers({ repo: join(repo, "absent") });
    expect(read.isErr()).toBe(true);
    expect(read._unsafeUnwrapErr().length).toBe(1);
  });
});
