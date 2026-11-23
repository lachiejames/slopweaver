/**
 * The `codex rules-context` hook's file half: which checkout it speaks for, read off a throwaway tree.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { rulesContextLines } from "../../../cli/commands/codex/rulesContextRun.js";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "sw-rules-context-"));
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), "# root\n\n@.claude/rules/imported.md\n");
  writeFileSync(join(root, ".claude", "rules", "imported.md"), "# imported\n");
  writeFileSync(join(root, ".claude", "rules", "area-cli.md"), "---\npaths:\n  - src/cli/**\n---\n# area\n");
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("rulesContextLines", () => {
  it("renders the imported rule, not the entry or a scoped rule, in a Slopweaver checkout", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "slopweaver" }));
    const lines = rulesContextLines({ root });
    expect(lines.filter((line) => line.startsWith("<!-- file: "))).toEqual([
      "<!-- file: .claude/rules/imported.md -->",
    ]);
    expect(lines).toContain("# imported");
  });

  it("says nothing in another repository", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "acme-admin" }));
    expect(rulesContextLines({ root })).toEqual([]);
  });

  it("says nothing where there is no package.json at all", () => {
    expect(rulesContextLines({ root })).toEqual([]);
  });
});
