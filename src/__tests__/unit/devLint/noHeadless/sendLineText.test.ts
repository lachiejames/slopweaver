import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH006 — a model basename hidden inside a sendLine call's own text field", () => {
  it("flags a bypass hiding claude -p inside sendLine's text field, anywhere in the tree", () => {
    const content = [
      "await sendLine({",
      "  exec,",
      '  text: `claude -p "do something headless"`,',
      "  workspaceRef,",
      "});",
    ].join("\n");
    const hits = scanNoHeadless({ content, path: "src/somewhere/else.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH006");
    expect(hits[0]!.line).toBe(3);
  });

  it("does NOT flag the one recognized visible claude cmux-spawn launch shape", () => {
    const content = [
      "await sendLine({",
      "  exec: deps.exec,",
      "  surfaceRef: workspace.surfaceRef,",
      "  text: `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}`,",
      "  wait: deps.wait,",
      "  workspaceRef: workspace.workspaceRef,",
      "});",
    ].join("\n");
    expect(scanNoHeadless({ content, path: "src/cmux/spawn.ts" })).toEqual([]);
  });

  it("does NOT flag the one recognized visible codex cmux-spawn launch shape", () => {
    const content = [
      "await sendLine({",
      "  exec: deps.exec,",
      "  surfaceRef: workspace.surfaceRef,",
      '  text: "codex --no-alt-screen",',
      "  wait: deps.wait,",
      "  workspaceRef: workspace.workspaceRef,",
      "});",
    ].join("\n");
    expect(scanNoHeadless({ content, path: "src/cmux/spawn.ts" })).toEqual([]);
  });

  it("recognizes the visible-launch shape identically regardless of which file it sits in — a pattern match, not a path allowlist", () => {
    const content =
      "await sendLine({ text: `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}` });";
    expect(scanNoHeadless({ content, path: "src/somewhere/unexpected.ts" })).toEqual([]);
  });

  /**
   * The exact gap tightening to equality closes: the OLD `startsWith("claude --plugin-dir ")` check accepted
   * ANY suffix after the recognized recipe, including a different variable entirely — which is
   * indistinguishable from a caller building the same-looking text from an untrusted or unpinned value. Only
   * this repo's own exact `${pluginDirSuffix}` interpolation is recognized now.
   */
  it("does NOT recognize the claude shape with a DIFFERENT interpolated variable — equality, not a prefix match", () => {
    const content = "await sendLine({ text: `claude --plugin-dir ${somethingElse}` });";
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.kind)).toEqual(["NH006"]);
  });

  it("still flags codex hidden the same way, not just claude", () => {
    const content = 'await sendLine({ text: `codex exec "headless"` });';
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.kind)).toEqual(["NH006"]);
  });

  it("does NOT flag a sendLine call whose text has nothing to do with a model runner", () => {
    const content = 'await sendLine({ text: "echo hello" });';
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag the bare word claude/codex OUTSIDE a sendLine call", () => {
    const content = 'const label = "claude-code"; const other = "codex";';
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });

  /**
   * A found-and-fixed defect: `TEXT_FIELD_VALUE` alternates backtick/double/single quoting into
   * three MUTUALLY EXCLUSIVE capture groups, but the reader only ever checked group 1 — so a double- or
   * single-quoted `text:` silently matched the overall regex while leaving group 1 `undefined`, and the
   * bypass read as "no text field found" rather than "found, and it names a model runner."
   */
  it("flags the bypass even through a DOUBLE-quoted text field, not just backticks", () => {
    const hits = scanNoHeadless({ content: 'await sendLine({ text: "codex exec headless" });', path: "src/x.ts" });
    expect(hits.map((h) => h.kind)).toEqual(["NH006"]);
  });

  it("flags the bypass even through a SINGLE-quoted text field", () => {
    const hits = scanNoHeadless({ content: "await sendLine({ text: 'claude -p headless' });", path: "src/x.ts" });
    expect(hits.map((h) => h.kind)).toEqual(["NH006"]);
  });

  /**
   * A found-and-fixed defect: recognition used to be tracked by LINE NUMBER, so one recognized
   * visible launch sharing a line with a separate, unrelated `sendLine` call incorrectly exempted that other
   * call too. Recognition is now checked per CALL, never by line.
   */
  it("does NOT let a recognized visible launch on one line hide a SEPARATE forbidden sendLine call on the SAME line", () => {
    const content =
      'await sendLine({ text: "codex --no-alt-screen" }); await sendLine({ text: "codex exec headless" });';
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits).toEqual([{ excerpt: "codex exec headless", kind: "NH006", line: 1, path: "src/x.ts" }]);
  });

  /**
   * A found-and-fixed defect: the naive `"([^"]*)"` pattern stops at the first quote character
   * regardless of whether it was escaped, so a valid escaped-quote string ending in `\"` truncated the
   * captured value BEFORE the hidden basename, reading as "no text field found" instead of "found, and it
   * hides a model runner."
   */
  it("flags a hidden basename that sits AFTER an escaped quote inside the text field", () => {
    const content = 'await sendLine({ text: "say \\"then codex exec headless\\"" });';
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.kind)).toEqual(["NH006"]);
  });
});
