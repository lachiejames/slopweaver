/**
 * The directory axis, checked against itself — two describe blocks, the shape `staleReferences.test.ts`
 * established: the first drives the pure functions on inline fixtures, the second reads THIS repository's
 * real area rules off disk.
 *
 * The property here is the one no other gate can see. Scoping is already gated (an area rule that loses its
 * `paths:` fails the always-on budget), presence in `AUTHORITY_DOCS` is a list, and the size cap and the
 * stale-reference sweep both reach these files by the `.claude/rules/` prefix. What none of them compares is
 * the glob against the tree the file's own heading claims, so `area-cli.md` scoped to `src/live/**` is green
 * everywhere while being handed to the wrong session and withheld from the right one.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { areaRuleIssues, areaRulePaths, areaRuleScope } from "../../../canon/areaRules.js";
import { AUTHORITY_DOCS } from "../../../devLint/docCounts.js";
import { repoRootOf, workingTreeFilesOf } from "../../../lib/gitRepo.js";

const SCOPED = ['---\npaths:\n  - "src/cli/**"\n---\n\n# Working in `src/cli/`\n\nprose\n'];

describe("areaRuleScope", () => {
  it("reads the heading's tree and the frontmatter's globs", () => {
    expect(areaRuleScope({ content: SCOPED[0]! })).toEqual({ globs: ["src/cli/**"], heading: "src/cli/" });
  });

  it("reads every glob in a multi-entry paths block", () => {
    const content = '---\npaths:\n  - "src/live/**"\n  - "src/live/listen/**"\n---\n\n# Working in `src/live/`\n';
    expect(areaRuleScope({ content }).globs).toEqual(["src/live/**", "src/live/listen/**"]);
  });

  it("reads single-quoted and bare globs without their quotes", () => {
    const content = "---\npaths:\n  - 'src/cli/**'\n  - src/live/**\n---\n\n# Working in `src/cli/`\n";
    expect(areaRuleScope({ content }).globs).toEqual(["src/cli/**", "src/live/**"]);
  });

  it("reads past a comment or blank line between paths items, which YAML does not end a sequence on", () => {
    const content =
      "---\npaths:\n  - \"src/cli/**\"\n  # supplemental scope\n\n  - 'src/live/**'\n---\n\n# Working in `src/cli/`\n";
    expect(areaRuleScope({ content }).globs).toEqual(["src/cli/**", "src/live/**"]);
  });

  it("reads a single-quoted glob carrying a double quote, which YAML treats as ordinary", () => {
    const content = "---\npaths:\n  - 'src/a\"b/**'\n---\n\n# Working in `src/a\"b/`\n";
    expect(areaRuleScope({ content })).toEqual({ globs: ['src/a"b/**'], heading: 'src/a"b/' });
  });

  it("reads only the paths key, not a sibling key's list", () => {
    const content = '---\npaths:\n  - "src/cli/**"\nother:\n  - "src/live/**"\n---\n\n# Working in `src/cli/`\n';
    expect(areaRuleScope({ content }).globs).toEqual(["src/cli/**"]);
  });

  it("reads paths when a sibling key's aliases would exhaust yaml's whole-document conversion", () => {
    const content =
      '---\npaths: ["src/cli/**"]\na: &a [x,x,x,x,x,x,x,x,x,x]\nb: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]\n' +
      "c: [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]\n---\n# Working in `src/cli/`\n";
    expect(areaRuleScope({ content })).toEqual({ globs: ["src/cli/**"], heading: "src/cli/" });
  });

  it("hands out a frozen scope, so one caller cannot alter what the next is given for the same file", () => {
    const content = '---\npaths:\n  - "src/frozen/**"\n---\n\n# Working in `src/frozen/`\n';
    const first = areaRuleScope({ content });
    expect(() => (first.globs as string[]).push("src/evil/**")).toThrow(TypeError);
    expect(areaRuleScope({ content }).globs).toEqual(["src/frozen/**"]);
  });

  it("scopes nothing when the frontmatter is not valid YAML", () => {
    const content = '---\npaths:\n  - "src/cli/**\n---\n\n# Working in `src/cli/`\n';
    expect(areaRuleScope({ content }).globs).toEqual([]);
  });

  it("stops the paths block at the next top-level key", () => {
    const content =
      '---\npaths:\n  - "src/cli/**"\ndescription: x\n  - "src/live/**"\n---\n\n# Working in `src/cli/`\n';
    expect(areaRuleScope({ content }).globs).toEqual(["src/cli/**"]);
  });

  it("reports an empty heading rather than guessing when the H1 does not match", () => {
    expect(areaRuleScope({ content: '---\npaths:\n  - "src/cli/**"\n---\n\n# Some other title\n' }).heading).toBe("");
  });

  it("reads the real H1, not a heading-shaped line quoted inside a code fence above it", () => {
    const content =
      '---\npaths:\n  - "src/handover/**"\n---\n\n```md\n# Working in `src/cli/`\n```\n\n# Working in `src/handover/`\n';
    expect(areaRuleScope({ content }).heading).toBe("src/handover/");
  });

  it("keeps a longer fence open past a shorter run of backticks inside it", () => {
    const content =
      '---\npaths:\n  - "src/cli/**"\n---\n\n````md\n```\n# Working in `src/cli/`\n````\n\n# Something else\n';
    expect(areaRuleScope({ content }).heading).toBe("");
  });

  it("opens no fence on a backtick run whose info string carries a backtick", () => {
    const content = '---\npaths:\n  - "src/cli/**"\n---\n\n``` bad`info\n# Working in `src/cli/`\n```\n';
    expect(areaRuleScope({ content }).heading).toBe("src/cli/");
  });

  it("counts an H1 indented by up to three spaces as the first heading", () => {
    const content = '---\npaths:\n  - "src/cli/**"\n---\n\n # Other\n\n# Working in `src/cli/`\n';
    expect(areaRuleScope({ content }).heading).toBe("");
  });

  it("reads only the first H1, so a later heading-shaped line names nothing", () => {
    const content = '---\npaths:\n  - "src/live/**"\n---\n\n# Something else\n\n# Working in `src/live/`\n';
    expect(areaRuleScope({ content }).heading).toBe("");
  });

  it("reads an H1 after a bare CR line ending, which CommonMark counts as a line break", () => {
    expect(areaRuleScope({ content: "preamble\r# Working in `src/cli/`\r" }).heading).toBe("src/cli/");
  });

  it("reads an H1 after a CRLF line ending", () => {
    expect(areaRuleScope({ content: "preamble\r\n# Working in `src/cli/`\r\n" }).heading).toBe("src/cli/");
  });

  it("skips a heading-shaped line inside a fence nested in a list item", () => {
    const content = '---\npaths:\n  - "src/cli/**"\n---\n\n- ```md\n  # Working in `src/cli/`\n  ```\n';
    expect(areaRuleScope({ content }).heading).toBe("");
  });

  it("returns a tree carrying an HTML-significant character as written, not as micromark escapes it", () => {
    expect(areaRuleScope({ content: "# Working in `src/a&b/`\n" }).heading).toBe("src/a&b/");
  });

  it("reads an H1 carrying a closing hash sequence, which CommonMark strips", () => {
    expect(areaRuleScope({ content: "# Working in `src/cli/` #\n" }).heading).toBe("src/cli/");
  });

  it("reads CRLF frontmatter, so a comment inside it is never taken for the H1", () => {
    const content = '---\r\n# metadata comment\r\npaths:\r\n  - "src/cli/**"\r\n---\r\n# Working in `src/cli/`\r\n';
    expect(areaRuleScope({ content })).toEqual({ globs: ["src/cli/**"], heading: "src/cli/" });
  });

  it("reports no globs when the file carries no frontmatter at all", () => {
    expect(areaRuleScope({ content: "# Working in `src/cli/`\n" }).globs).toEqual([]);
  });

  it("ignores a paths key in the body, which is prose to Claude Code and scopes nothing", () => {
    expect(areaRuleScope({ content: '# Working in `src/cli/`\n\npaths:\n  - "src/cli/**"\n' }).globs).toEqual([]);
  });

  it("ignores an indented paths key, which scopes nothing", () => {
    expect(areaRuleScope({ content: "---\nmeta:\n  paths:\n---\n\n# Working in `src/cli/`\n" }).globs).toEqual([]);
  });
});

describe("areaRuleIssues", () => {
  it("reports nothing when the glob sits under the tree the heading names", () => {
    expect(areaRuleIssues({ doc: { content: SCOPED[0]!, path: ".claude/rules/area-cli.md" } })).toEqual([]);
  });

  it("names the globs and the tree when a copy-paste scopes a rule at the wrong subsystem", () => {
    const content = '---\npaths:\n  - "src/live/**"\n---\n\n# Working in `src/cli/`\n';
    expect(areaRuleIssues({ doc: { content, path: ".claude/rules/area-cli.md" } })).toEqual([
      ".claude/rules/area-cli.md: scoped to `src/live/**`, none of which covers the `src/cli/` its heading names",
    ]);
  });

  it("accepts a second glob reaching a subsystem's verbs in another tree, which is coverage not drift", () => {
    const content =
      '---\npaths:\n  - "src/handover/**"\n  - "src/cli/commands/handover/**"\n---\n\n# Working in `src/handover/`\n';
    expect(areaRuleIssues({ doc: { content, path: ".claude/rules/area-handover.md" } })).toEqual([]);
  });

  it("reports an unscoped area rule, which would load into every session", () => {
    const issues = areaRuleIssues({ doc: { content: "# Working in `src/cli/`\n", path: ".claude/rules/area-cli.md" } });
    expect(issues).toEqual([
      ".claude/rules/area-cli.md: no top-level `paths:` block, so it would load into every session",
    ]);
  });

  it("stops at the heading when there is no subject to compare a glob against", () => {
    const content = '---\npaths:\n  - "src/live/**"\n---\n\n# Untitled\n';
    expect(areaRuleIssues({ doc: { content, path: ".claude/rules/area-cli.md" } })).toEqual([
      ".claude/rules/area-cli.md: no `# Working in `src/<tree>/`` heading, so it names no subject",
    ]);
  });
});

describe("areaRulePaths", () => {
  it("selects the area rules and leaves every other rule alone", () => {
    const paths = [".claude/rules/testing.md", ".claude/rules/area-live.md", ".claude/rules/area-cli.md"];
    expect(areaRulePaths({ paths })).toEqual([".claude/rules/area-cli.md", ".claude/rules/area-live.md"]);
  });
});

describe("this repository's real area rules", () => {
  const root = repoRootOf({ importMetaUrl: import.meta.url });
  const paths = areaRulePaths({ paths: workingTreeFilesOf({ pathspec: ".claude/rules/*.md", root }) });
  const docs = paths.map((path) => ({ content: readFileSync(join(root, path), "utf8"), path }));

  it("finds the area rules — an empty scan is a fault, never a clean bill", () => {
    expect(paths.length).toBeGreaterThan(0);
  });

  it("scopes every area rule to the tree its own heading names", () => {
    expect(docs.flatMap((doc) => areaRuleIssues({ doc }))).toEqual([]);
  });

  it("registers every area rule as an authority doc, so doc-counts refuses an inventory claim in one", () => {
    expect(paths.filter((path) => !AUTHORITY_DOCS.includes(path))).toEqual([]);
  });

  it("carries no authority-doc registration for an area rule that has since been deleted", () => {
    const registered = AUTHORITY_DOCS.filter((path) => path.startsWith(".claude/rules/area-"));
    expect(registered.filter((path) => !paths.includes(path))).toEqual([]);
  });
});
