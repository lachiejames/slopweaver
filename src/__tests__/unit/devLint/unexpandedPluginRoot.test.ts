/**
 * The `unexpanded-plugin-root` gate — a command this code PRINTS may not embed a variable only the Claude
 * Code harness supplies.
 *
 * Pure: source text in, hits out. The scanner parses in memory, so nothing here reads a file or shells a
 * git. The scope predicate is asserted directly rather than inferred from a clean whole-repo run, because
 * scope is the half of a gate that fails silently when it is wrong.
 */
import { describe, expect, it } from "vitest";

import { isScannablePath, scanUnexpandedPluginRoot } from "../../../devLint/unexpandedPluginRoot.js";

/**
 * The line finding `688-s-ticker-remedy-line-embeds-claude-plugin` was raised on, verbatim from
 * `cli/commands/turn/resume.ts` before the fix — a template literal whose escaped `\${` emits the variable
 * rather than interpolating it. The one input that proves this gate would have caught the defect it exists
 * for, rather than merely catching something.
 */
const THE_DEFECT = [
  "const lines = [",
  '  `  0a. Start the card\'s clock ONCE, backgrounded: "\\${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" turn watch --brief ${briefPath} &`,',
  "];",
].join("\n");

describe("scanUnexpandedPluginRoot", () => {
  it("catches the escaped template form the finding was raised on, and names its line", () => {
    const hits = scanUnexpandedPluginRoot({ content: THE_DEFECT, path: "src/cli/commands/turn/resume.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.path).toBe("src/cli/commands/turn/resume.ts");
    expect(hits[0]!.message).toContain("CLAUDE_PLUGIN_ROOT");
  });

  it("catches the plain string form too, where no escape is involved at all", () => {
    const hits = scanUnexpandedPluginRoot({
      content: 'const cmd = "${CLAUDE_PLUGIN_ROOT}/bin/slopweaver";',
      path: "src/a.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(1);
  });

  it("catches the launcher's own PLUGIN_ROOT spelling", () => {
    const hits = scanUnexpandedPluginRoot({ content: 'run("${PLUGIN_ROOT}/bin/slopweaver");', path: "src/a.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.message).toContain("PLUGIN_ROOT");
  });

  it("reports each occurrence separately, so a file with two of them cannot be half-fixed quietly", () => {
    const hits = scanUnexpandedPluginRoot({
      content: ['const a = "${CLAUDE_PLUGIN_ROOT}/bin/slopweaver";', 'const b = "${PLUGIN_ROOT}/bin/slopweaver";'].join(
        "\n",
      ),
      path: "src/a.ts",
    });
    expect(hits.map((hit) => hit.line)).toEqual([1, 2]);
  });

  /**
   * A template with the dollar escaped and no real hole is a `NoSubstitutionTemplateLiteral`, a different
   * node kind from both a string literal and a template span — the third shape the scanner has to read.
   */
  it("finds one in a no-substitution template, a third node kind again", () => {
    const hits = scanUnexpandedPluginRoot({
      content: "const cmd = `\\${CLAUDE_PLUGIN_ROOT}/bin/slopweaver`;",
      path: "src/a.ts",
    });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(1);
  });

  it("passes the resolved absolute path the fix emits", () => {
    const hits = scanUnexpandedPluginRoot({
      content: 'const cmd = `"${launcher}" turn watch --brief ${briefPath} &`;',
      path: "src/a.ts",
    });
    expect(hits).toEqual([]);
  });

  /**
   * The AST walk is what buys this, and it is the reason the gate reads nodes rather than lines: every file
   * that DESCRIBES this defect — the two fixed sites, `lib/pluginRoot.ts`, this gate's own header — spells
   * the literal in prose. A line-matching gate would have had to exempt them all.
   */
  it("never reads a comment, so prose naming the literal is outside the criterion", () => {
    const content = [
      "/** Never emit `${CLAUDE_PLUGIN_ROOT}/bin/slopweaver` — the harness substitutes it, a shell does not. */",
      "// also not this: ${PLUGIN_ROOT}",
      "const cmd = launcher;",
    ].join("\n");
    expect(scanUnexpandedPluginRoot({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("passes a GitHub Actions expression, whose second brace is not a variable name", () => {
    const hits = scanUnexpandedPluginRoot({
      content: "const expr = `\\${{ ${jobs.join(', ')} }}`;",
      path: "src/devLint/ciOffloadContract.ts",
    });
    expect(hits).toEqual([]);
  });

  /**
   * The two sites the first, broader shape of this gate reddened on, both correct. `HOME_PLACEHOLDER` is the
   * token a frozen replay fixture's absolute paths become; `LOCAL_ROOTS` is a matcher over a composer's own
   * prose. In each the variable's NAME is the value, and neither is a command anybody runs.
   */
  it("passes a placeholder token and a matcher over a state-home variable — neither is a printed command", () => {
    const content = [
      'export const HOME_PLACEHOLDER = "${SLOPWEAVER_HOME}";',
      'const LOCAL_ROOTS = ["~", "$SLOPWEAVER_HOME", "${SLOPWEAVER_HOME}"] as const;',
    ].join("\n");
    expect(scanUnexpandedPluginRoot({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("passes the brace-less spelling, the blind spot its own header names", () => {
    const hits = scanUnexpandedPluginRoot({
      content: 'const cmd = "$CLAUDE_PLUGIN_ROOT/bin/slopweaver";',
      path: "src/a.ts",
    });
    expect(hits).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans a tracked source under each declared tree", () => {
    expect(isScannablePath({ path: "src/cli/commands/turn/resume.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse-admit.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/judgementAssertion.ts" })).toBe(true);
  });

  /**
   * `src/__tests__/unit/docs/coverage.test.ts` asserts that the doc-coverage pattern still matches
   * `"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" facts`, which is the form every `SKILL.md` correctly writes. A
   * test naming the literal is exercising the substitution contract, not printing an instruction.
   */
  it("never scans the test tree, whose cases assert on the SKILL.md form deliberately", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/docs/coverage.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/replayFixture.ts" })).toBe(false);
  });

  it("never scans a skill or any other markdown — that is where the harness does substitute", () => {
    expect(isScannablePath({ path: "skills/store/SKILL.md" })).toBe(false);
    expect(isScannablePath({ path: "docs/install-stays-current.md" })).toBe(false);
    expect(isScannablePath({ path: "hooks/hooks.json" })).toBe(false);
  });

  it("never scans its own files, so its criterion may be spelled in them", () => {
    expect(isScannablePath({ path: "src/devLint/unexpandedPluginRoot.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/unexpandedPluginRoot.entry.ts" })).toBe(false);
  });
});
