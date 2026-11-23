import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { UNSCOPED_RULES } from "../../../canon/alwaysOnDocs.js";
import { codexRulesDocuments, renderCodexRulesContext } from "../../../codex/rulesContext.js";

const SCOPED = "---\npaths:\n  - src/cli/**\n---\n# scoped\n";

/** A checkout in memory: AGENTS.md importing one scoped rule, one unscoped rule, one scoped area rule. */
const TREE: Readonly<Record<string, string>> = {
  ".claude/rules/area-cli.md": SCOPED,
  ".claude/rules/imported.md": SCOPED,
  ".claude/rules/unscoped.md": "# unscoped\n",
  "AGENTS.md": "# root\n\n@.claude/rules/imported.md\n",
};

const readDoc = ({ path }: { path: string }): string | undefined => TREE[path];
const ruleFiles = Object.keys(TREE).filter((path) => path.startsWith(".claude/rules/"));

describe("codexRulesDocuments", () => {
  it("returns the imports and the unscoped rules, never the entry or a scoped rule nothing imports", () => {
    const documents = codexRulesDocuments({ entry: "AGENTS.md", readDoc, ruleFiles });
    expect(documents.map((document) => document.path)).toEqual([
      ".claude/rules/imported.md",
      ".claude/rules/unscoped.md",
    ]);
    expect(documents[1]!.content).toBe("# unscoped\n");
  });

  it("returns a dangling import with no content rather than dropping it", () => {
    const documents = codexRulesDocuments({
      entry: "AGENTS.md",
      readDoc: ({ path }) => (path === "AGENTS.md" ? "@.claude/rules/gone.md\n" : undefined),
      ruleFiles: [],
    });
    expect(documents).toEqual([{ content: undefined, path: ".claude/rules/gone.md" }]);
  });

  it("returns nothing when the entry imports nothing and every rule is scoped", () => {
    const documents = codexRulesDocuments({
      entry: "AGENTS.md",
      readDoc: ({ path }) => (path === "AGENTS.md" ? "# root\n" : SCOPED),
      ruleFiles: [".claude/rules/area-cli.md"],
    });
    expect(documents).toEqual([]);
  });

  it("selects exactly the always-on rules this repository declares", () => {
    const root = process.cwd();
    const realRead = ({ path }: { path: string }): string | undefined => readFileSync(join(root, path), "utf8");
    const realRules = readdirSync(join(root, ".claude", "rules")).map((name) => `.claude/rules/${name}`);
    const paths = codexRulesDocuments({ entry: "AGENTS.md", readDoc: realRead, ruleFiles: realRules }).map(
      (document) => document.path,
    );
    expect(UNSCOPED_RULES.length).toBeGreaterThan(0);
    expect(paths.toSorted()).toEqual([...UNSCOPED_RULES].toSorted());
  });
});

describe("renderCodexRulesContext", () => {
  it("renders nothing for no documents", () => {
    expect(renderCodexRulesContext({ documents: [] })).toEqual([]);
  });

  it("names each file above its text and names an unreadable one instead of dropping it", () => {
    const lines = renderCodexRulesContext({
      documents: [
        { content: "# one\n\nbody\n", path: ".claude/rules/one.md" },
        { content: undefined, path: ".claude/rules/gone.md" },
      ],
    });
    expect(lines.slice(3)).toEqual([
      "",
      "<!-- file: .claude/rules/one.md -->",
      "",
      "# one\n\nbody",
      "",
      "<!-- file: .claude/rules/gone.md -->",
      "",
      "(.claude/rules/gone.md could not be read from this checkout — open it before writing code.)",
    ]);
    expect(lines[2]).toContain("these 2 files");
  });
});
