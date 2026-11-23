/**
 * The always-on docs budget — a tape measure over the context every session pays for before it reads code.
 *
 * Two describe blocks, the shape `staleReferences.test.ts` established: the first drives the pure measuring
 * functions on inline fixtures and never touches disk; the second measures THIS repository's real always-on
 * set and fails when a number grows past its budget, printing the numbers in the failure itself.
 *
 * ## It measures. It never cuts.
 *
 * The owner's constraint on this gate, stated before it was written: it must never be able to satisfy itself
 * by removing content. So it has no fixer, no autofix flag and no line-cutting mode — the only thing it can do
 * on failure is print how far over budget something is. Proving that the content which left a file is still
 * reachable is a SEPARATE check, and that split is deliberate: neither can green the other.
 *
 * Every ratchet checked below now lives in `../../../canon/alwaysOnDocs.js`, imported rather than restated,
 * so this test and the merge-time re-measurement in `../../../outbound/github/docsBudgetSweep.js` can never
 * disagree on a ceiling.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alwaysOnEntry,
  alwaysOnPaths,
  BYTE_SLACK,
  budgetOverruns,
  type DocBudget,
  docBudgetsFor,
  importedPathsOf,
  isPathScoped,
  LINE_SLACK,
  measureDoc,
  splitFrontMatter,
  staleBudgets,
  totalSize,
  UNSCOPED_RULES,
} from "../../../canon/alwaysOnDocs.js";
import { repoRootOf, workingTreeFilesOf } from "../../../lib/gitRepo.js";

describe("splitFrontMatter", () => {
  it("separates frontmatter from body", () => {
    expect(splitFrontMatter({ content: "---\npaths:\n  - a\n---\n\n# Title\n" })).toEqual({
      body: "\n# Title\n",
      frontMatter: ["paths:", "  - a"],
    });
  });

  it("treats a file with no opening fence as all body", () => {
    expect(splitFrontMatter({ content: "# Title\n\nprose\n" })).toEqual({
      body: "# Title\n\nprose\n",
      frontMatter: [],
    });
  });

  it("treats an UNCLOSED fence as all body rather than swallowing the document", () => {
    expect(splitFrontMatter({ content: "---\npaths:\n\n# Title\n" })).toEqual({
      body: "---\npaths:\n\n# Title\n",
      frontMatter: [],
    });
  });

  it("handles an empty file", () => {
    expect(splitFrontMatter({ content: "" })).toEqual({ body: "", frontMatter: [] });
  });
});

describe("isPathScoped", () => {
  it("sees a top-level paths key", () => {
    expect(isPathScoped({ content: '---\npaths:\n  - "src/**/*.ts"\n---\n\nrule\n' })).toBe(true);
  });

  it("sees paths written with a space before the colon", () => {
    expect(isPathScoped({ content: '---\npaths :\n  - "src/**/*.ts"\n---\n' })).toBe(true);
  });

  it("does NOT count an indented paths key — a nested key scopes nothing", () => {
    expect(isPathScoped({ content: "---\ndescription: x\n  paths:\n    - a\n---\n" })).toBe(false);
  });

  it("does not count the word paths in the body", () => {
    expect(isPathScoped({ content: "# Rule\n\npaths: are discussed here\n" })).toBe(false);
  });

  it("treats a rule with no frontmatter as unconditional", () => {
    expect(isPathScoped({ content: "# Testing\n" })).toBe(false);
  });
});

describe("measureDoc", () => {
  it("counts a newline-terminated file the way wc -l does", () => {
    expect(measureDoc({ content: "a\nb\nc\n" })).toEqual({ bytes: 6, lines: 3 });
  });

  it("counts a final line with no trailing newline", () => {
    expect(measureDoc({ content: "a\nb" })).toEqual({ bytes: 3, lines: 2 });
  });

  it("reports zero lines for an empty file", () => {
    expect(measureDoc({ content: "" })).toEqual({ bytes: 0, lines: 0 });
  });

  it("counts BYTES, not code points — a multi-byte character costs what it costs", () => {
    expect(measureDoc({ content: "—\n" })).toEqual({ bytes: 4, lines: 1 });
  });
});

describe("totalSize", () => {
  it("sums both units", () => {
    expect(
      totalSize({
        sizes: [
          { bytes: 10, lines: 1 },
          { bytes: 20, lines: 2 },
        ],
      }),
    ).toEqual({ bytes: 30, lines: 3 });
  });

  it("is zero for nothing", () => {
    expect(totalSize({ sizes: [] })).toEqual({ bytes: 0, lines: 0 });
  });
});

describe("budgetOverruns", () => {
  const over: DocBudget = { budget: 200, label: "AGENTS.md", measured: 250, target: 200, unit: "lines" };

  it("names the overshoot and the target in the message", () => {
    expect(budgetOverruns({ budgets: [over] })).toEqual([
      "AGENTS.md: 250 lines — 50 over its budget of 200 (documented target 200). Move content out to a " +
        "linked doc or a skill; do not raise the budget.",
    ]);
  });

  it("omits the target clause entirely for a budget that has no published figure", () => {
    expect(
      budgetOverruns({ budgets: [{ budget: 200, label: "the always-on set", measured: 250, unit: "bytes" }] }),
    ).toEqual([
      "the always-on set: 250 bytes — 50 over its budget of 200. Move content out to a linked doc or a " +
        "skill; do not raise the budget.",
    ]);
  });

  it("passes a measurement exactly ON budget", () => {
    expect(budgetOverruns({ budgets: [{ ...over, measured: 200 }] })).toEqual([]);
  });

  it("passes a measurement under budget", () => {
    expect(budgetOverruns({ budgets: [{ ...over, measured: 199 }] })).toEqual([]);
  });

  it("reports nothing for no budgets", () => {
    expect(budgetOverruns({ budgets: [] })).toEqual([]);
  });
});

describe("staleBudgets", () => {
  const slack = 25;
  const entry: DocBudget = { budget: 575, label: "always-on set", measured: 575, target: 200, unit: "lines" };

  it("says nothing while the budget tracks the measurement", () => {
    expect(staleBudgets({ budgets: [entry], slack })).toEqual([]);
  });

  it("tolerates slack up to the allowance", () => {
    expect(staleBudgets({ budgets: [{ ...entry, measured: 550 }], slack })).toEqual([]);
  });

  it("demands the budget be lowered once the saving exceeds the allowance", () => {
    expect(staleBudgets({ budgets: [{ ...entry, measured: 549 }], slack })).toEqual([
      "always-on set: 549 lines against a budget of 575 — 26 of slack, more than the 25 allowed. Lower the " +
        "budget to 549 so the saving cannot be spent again.",
    ]);
  });
});

describe("docBudgetsFor", () => {
  it("sums the always-on set and checks AGENTS.md's own byte cap when it is present", () => {
    const budgets = docBudgetsFor({
      alwaysOn: [
        { content: "a\nb\n", path: "CLAUDE.md" },
        { content: "c\n", path: "AGENTS.md" },
      ],
      skills: [],
    });
    expect(budgets).toEqual([
      { budget: 969, label: "the always-on set (CLAUDE.md, AGENTS.md)", measured: 3, target: 200, unit: "lines" },
      { budget: 71_170, label: "the always-on set", measured: 6, unit: "bytes" },
      {
        budget: 32_768,
        label: "AGENTS.md, against the cap Codex truncates at mid-word",
        measured: 2,
        target: 32_768,
        unit: "bytes",
      },
    ]);
  });

  it("omits the AGENTS.md-specific budget when AGENTS.md is not in the always-on set", () => {
    const budgets = docBudgetsFor({ alwaysOn: [{ content: "a\n", path: "CLAUDE.md" }], skills: [] });
    expect(budgets.some((entry) => entry.label.includes("Codex truncates"))).toBe(false);
  });

  it("checks each skill's OWN body, excluding its frontmatter, against the shared cap", () => {
    const budgets = docBudgetsFor({
      alwaysOn: [],
      skills: [{ content: "---\ndescription: x\n---\nbody line one\nbody line two\n", path: "skills/x/SKILL.md" }],
    });
    expect(budgets.filter((entry) => entry.label.endsWith(" body"))).toEqual([
      { budget: 500, label: "skills/x/SKILL.md body", measured: 2, target: 500, unit: "lines" },
    ]);
  });
});

describe("importedPathsOf", () => {
  it("reads a whole-line @ import and resolves it against the importing file's own directory", () => {
    expect(importedPathsOf({ content: "@AGENTS.md\n", from: "CLAUDE.md" })).toEqual(["AGENTS.md"]);
    expect(importedPathsOf({ content: "@sibling.md\n", from: ".claude/rules/a.md" })).toEqual([
      ".claude/rules/sibling.md",
    ]);
  });

  it("keeps declaration order and every duplicate", () => {
    expect(importedPathsOf({ content: "@a.md\n@b.md\n@a.md\n", from: "AGENTS.md" })).toEqual(["a.md", "b.md", "a.md"]);
  });

  it("honours an inline import, which is what Claude Code itself expands", () => {
    expect(importedPathsOf({ content: "See @AGENTS.md for the rest.\n", from: "CLAUDE.md" })).toEqual(["AGENTS.md"]);
    expect(importedPathsOf({ content: "* @b.md\n", from: "AGENTS.md" })).toEqual(["b.md"]);
  });

  it("keeps a longer fence open through the shorter one it is demonstrating", () => {
    expect(
      importedPathsOf({ content: "````markdown\n```\n@hidden.md\n```\n````\n@real.md\n", from: "CLAUDE.md" }),
    ).toEqual(["real.md"]);
  });

  it("blanks a code span whatever its delimiter run length", () => {
    expect(
      importedPathsOf({ content: "Example: `` @hidden.md `` and `@also.md` then @real.md\n", from: "CLAUDE.md" }),
    ).toEqual(["real.md"]);
  });

  it("never reads an email address, a backticked tag or a fenced example as an import", () => {
    expect(
      importedPathsOf({ content: "mail admin@slopweaver.ai and see `@param x.md` today\n", from: "AGENTS.md" }),
    ).toEqual([]);
  });

  it("takes any extension, and refuses a handle, a fenced example and anything outside the checkout", () => {
    expect(importedPathsOf({ content: "@notes.txt\n", from: "CLAUDE.md" })).toEqual(["notes.txt"]);
    expect(
      importedPathsOf({ content: "@acme-bot\n@~/home.md\n@/etc/x.md\n@../outside.md\n", from: "CLAUDE.md" }),
    ).toEqual([]);
    expect(importedPathsOf({ content: "```\n@AGENTS.md\n```\n@real.md\n", from: "CLAUDE.md" })).toEqual(["real.md"]);
  });
});

describe("alwaysOnEntry", () => {
  const present =
    ({ paths }: { paths: readonly string[] }) =>
    ({ path }: { path: string }) =>
      paths.includes(path);

  it("enters at AGENTS.md when no CLAUDE.md exists, which Claude Code then reads natively", () => {
    expect(alwaysOnEntry({ exists: present({ paths: ["AGENTS.md"] }) })).toBe("AGENTS.md");
  });

  it("enters at a root CLAUDE.md whenever one exists, because the host then reads it instead", () => {
    expect(alwaysOnEntry({ exists: present({ paths: ["AGENTS.md", "CLAUDE.md"] }) })).toBe("CLAUDE.md");
  });

  it("enters at .claude/CLAUDE.md when that is the only CLAUDE.md", () => {
    expect(alwaysOnEntry({ exists: present({ paths: ["AGENTS.md", ".claude/CLAUDE.md"] }) })).toBe(".claude/CLAUDE.md");
  });

  it("still names AGENTS.md in an empty tree, so the walk reports it unreadable rather than measuring nothing", () => {
    expect(alwaysOnEntry({ exists: present({ paths: [] }) })).toBe("AGENTS.md");
  });
});

describe("alwaysOnPaths", () => {
  const readerOf =
    ({ docs }: { docs: Record<string, string> }) =>
    ({ path }: { path: string }): string | undefined =>
      docs[path];

  it("follows the second hop, so a rule reached only by an import is in the set", () => {
    const docs = {
      "AGENTS.md": "@.claude/rules/typescript-patterns.md\n",
      "CLAUDE.md": "@AGENTS.md\n",
      ".claude/rules/typescript-patterns.md": "---\npaths:\n  - src/**\n---\nbody\n",
    };
    expect(alwaysOnPaths({ entry: "CLAUDE.md", readDoc: readerOf({ docs }), unscopedRules: [] })).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      ".claude/rules/typescript-patterns.md",
    ]);
  });

  it("appends an unscoped rule no import reached, and never lists one twice", () => {
    const docs = {
      "AGENTS.md": "@.claude/rules/cross.md\n",
      "CLAUDE.md": "@AGENTS.md\n",
      ".claude/rules/cross.md": "x\n",
    };
    expect(
      alwaysOnPaths({
        entry: "CLAUDE.md",
        readDoc: readerOf({ docs }),
        unscopedRules: [".claude/rules/cross.md", ".claude/rules/grants.md"],
      }),
    ).toEqual(["CLAUDE.md", "AGENTS.md", ".claude/rules/cross.md", ".claude/rules/grants.md"]);
  });

  it("terminates on an import cycle", () => {
    const docs = { "a.md": "@b.md\n", "b.md": "@a.md\n" };
    expect(alwaysOnPaths({ entry: "a.md", readDoc: readerOf({ docs }), unscopedRules: [] })).toEqual(["a.md", "b.md"]);
  });

  it("returns a dangling import rather than hiding it, and does not descend into it", () => {
    const docs = { "CLAUDE.md": "@gone.md\n" };
    expect(alwaysOnPaths({ entry: "CLAUDE.md", readDoc: readerOf({ docs }), unscopedRules: [] })).toEqual([
      "CLAUDE.md",
      "gone.md",
    ]);
  });

  it("returns the entry alone when it imports nothing", () => {
    expect(
      alwaysOnPaths({ entry: "CLAUDE.md", readDoc: readerOf({ docs: { "CLAUDE.md": "hi\n" } }), unscopedRules: [] }),
    ).toEqual(["CLAUDE.md"]);
  });
});

describe("the real always-on docs budget", () => {
  it("has at least one entry in UNSCOPED_RULES, so the guards below are not vacuously green", () => {
    expect(UNSCOPED_RULES.length).toBeGreaterThan(0);
  });

  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const read = ({ path }: { path: string }): string => readFileSync(join(root, path), "utf8");
  const readOrUndefined = ({ path }: { path: string }): string | undefined =>
    existsSync(join(root, path)) ? read({ path }) : undefined;
  const ruleFiles = workingTreeFilesOf({ root, pathspec: ".claude/rules/*.md" });
  const skillFiles = workingTreeFilesOf({ root, pathspec: "skills/*/SKILL.md" });
  const unscoped = ruleFiles.filter((path) => !isPathScoped({ content: read({ path }) }));
  // DISCOVERED, never listed — `AGENTS.md` and the three code-standards rules it `@`-imports arrive by the same
  // walk a Claude Code session does, which is what a literal list left uncounted.
  const hostEntry = alwaysOnEntry({ exists: ({ path }) => existsSync(join(root, path)) });
  const alwaysOnPathList = alwaysOnPaths({ entry: hostEntry, readDoc: readOrUndefined, unscopedRules: unscoped });

  // Assembled by the SAME function `../../../outbound/github/docsBudgetSweep.js` calls at merge time, over
  // content read off disk instead of off a merged git tree — see `docBudgetsFor`'s own header.
  const budgets = docBudgetsFor({
    alwaysOn: alwaysOnPathList.map((path) => ({ content: read({ path }), path })),
    skills: skillFiles.map((path) => ({ content: read({ path }), path })),
  });
  const lineBudgets = budgets.filter((entry) => entry.unit === "lines" && entry.label.startsWith("the always-on set"));
  const byteBudgets = budgets.filter((entry) => entry.unit === "bytes" && entry.label === "the always-on set");

  it("scans a non-empty set of rules and skills — an empty scan is a fault, never a clean bill", () => {
    expect(ruleFiles.length > 0).toBe(true);
    expect(skillFiles.length > 0).toBe(true);
  });

  it("keeps the always-on line count inside its budget", () => {
    expect(budgetOverruns({ budgets: lineBudgets })).toEqual([]);
  });

  it("keeps the always-on byte count inside its budget", () => {
    expect(budgetOverruns({ budgets: byteBudgets })).toEqual([]);
  });

  it("ratchets the line budget down as content moves out", () => {
    expect(staleBudgets({ budgets: lineBudgets, slack: LINE_SLACK })).toEqual([]);
  });

  it("ratchets the byte budget down as content moves out", () => {
    expect(staleBudgets({ budgets: byteBudgets, slack: BYTE_SLACK })).toEqual([]);
  });

  it("keeps AGENTS.md under the byte cap Codex silently truncates at", () => {
    expect(
      budgetOverruns({ budgets: budgets.filter((entry) => entry.label.includes("Codex truncates at mid-word")) }),
    ).toEqual([]);
  });

  it("enters at AGENTS.md, which Claude Code reads natively because no CLAUDE.md wraps it", () => {
    expect(hostEntry).toBe("AGENTS.md");
  });

  it("counts the path-scoped rules AGENTS.md imports, which no literal list ever reached", () => {
    expect(alwaysOnPathList).toEqual([
      "AGENTS.md",
      ".claude/rules/typescript-patterns.md",
      ".claude/rules/testing.md",
      ".claude/rules/error-handling.md",
      ".claude/rules/cross-session-messages.md",
      ".claude/rules/journalled-grants.md",
    ]);
  });

  it("carries no unconditional rule that is missing from the declared list", () => {
    expect(unscoped.filter((path) => !UNSCOPED_RULES.includes(path))).toEqual([]);
  });

  it("carries no declared unconditional rule that has since been path-scoped or removed", () => {
    expect(UNSCOPED_RULES.filter((path) => !unscoped.includes(path))).toEqual([]);
  });

  it("keeps every SKILL.md body under the recurring-cost cap", () => {
    expect(budgetOverruns({ budgets: budgets.filter((entry) => entry.label.endsWith(" body")) })).toEqual([]);
  });
});
