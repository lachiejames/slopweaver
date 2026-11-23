import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH007 — a launch line built in a helper and returned, which NH006 cannot see", () => {
  // The hole this closes was measured, not imagined: `src/cmux/spawn.ts` stopped writing its launch text
  // inline and started building it in `bootLine()`, so the `sendLine` call reads `text: line` — a bare
  // identifier with no basename in it — while the literal sits in a `return` NH003 does not treat as
  // command position. `visibleCmuxLaunch` matched ZERO call sites in the real file, so the deliberate
  // recognition had become dead code and the intended launch was passing by accident.
  it("flags a headless launch returned from a helper", () => {
    const content = ["function bootLine() {", "  return `claude -p 'do the thing'`;", "}"].join("\n");
    const hits = scanNoHeadless({ content, path: "src/cmux/spawn.ts" });

    expect(hits.map((hit) => hit.kind)).toEqual(["NH007"]);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.excerpt).toBe("claude -p 'do the thing'");
  });

  it("does NOT flag the recognized claude launch, which is the exact shape spawn.ts returns", () => {
    const content = [
      "function bootLine() {",
      "  return `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix}${templateSuffix}`;",
      "}",
    ].join("\n");

    expect(scanNoHeadless({ content, path: "src/cmux/spawn.ts" })).toEqual([]);
  });

  it("does NOT flag the recognized codex launch", () => {
    const content = ["function bootLine() {", '  return "codex --no-alt-screen";', "}"].join("\n");

    expect(scanNoHeadless({ content, path: "src/cmux/spawn.ts" })).toEqual([]);
  });

  it("does NOT flag the recognized codex seat launch, which carries a routed CODEX_HOME prefix", () => {
    const content = [
      "function codexBootLine() {",
      "  return `${homePrefix}codex --no-alt-screen --model ${CODEX_MODEL}${browserOffSuffix}`;",
      "}",
    ].join("\n");

    expect(scanNoHeadless({ content, path: "src/cmux/spawn.ts" })).toEqual([]);
  });

  /**
   * The falsifiable partner of the case above, and the defect that made NH007 read past a leading
   * interpolation at all: the SAME line with `exec` in it was clean while the gate claimed to recognize
   * launches by exact text. An environment prefix is not a command, so the basename behind it is still in
   * command position.
   */
  it("flags a headless launch hiding behind an environment prefix", () => {
    const content = [
      "function codexBootLine() {",
      "  return `${homePrefix}codex exec --model ${CODEX_MODEL}`;",
      "}",
    ].join("\n");

    const hits = scanNoHeadless({ content, path: "src/cmux/spawn.ts" });

    expect(hits.map((hit) => hit.kind)).toEqual(["NH007"]);
    expect(hits[0]!.excerpt).toBe("${homePrefix}codex exec --model ${CODEX_MODEL}");
  });

  it("flags a recognized launch with anything appended, because equality is the whole point", () => {
    const content = [
      "function bootLine() {",
      "  return `claude${pluginDirSuffix}${modelSuffix}${nameSuffix} ; codex exec`;",
      "}",
    ].join("\n");

    expect(scanNoHeadless({ content, path: "src/cmux/spawn.ts" }).map((hit) => hit.kind)).toContain("NH007");
  });

  /**
   * NH003 catches the APPENDED runner for its own reason — a control operator is command position — and that
   * is asserted beside NH007 so the two rules' coverage cannot collapse into one. Both fire here: NH007
   * reads past a leading `${…}` environment prefix too, so the shipped literal's own
   * basename is no longer invisible to it either.
   */
  it("flags an appended runner behind the store prefix, under both command-position rules", () => {
    const content = [
      "function bootLine() {",
      "  return `${storePrefix}claude${pluginDirSuffix}${modelSuffix}${effortSuffix}${nameSuffix} ; codex exec`;",
      "}",
    ].join("\n");

    const kinds = scanNoHeadless({ content, path: "src/cmux/spawn.ts" }).map((hit) => hit.kind);

    expect(kinds).toContain("NH003");
    expect(kinds).toContain("NH007");
  });

  it("does NOT flag a diagnostic sentence that opens with a runner's name", () => {
    // Measured false positive: `doctor/run.ts` returns lines beginning "codex config: none — …". Command
    // position alone reported both of them, so a label-colon-space is treated as prose.
    const content = [
      "function codexConfigLine() {",
      '  return "codex config: none — nothing is configured";',
      "}",
    ].join("\n");

    expect(scanNoHeadless({ content, path: "src/cli/commands/doctor/run.ts" })).toEqual([]);
  });

  it("does NOT flag prose naming a runner away from command position", () => {
    const content = ["function describe() {", '  return "the claude session stays visible";', "}"].join("\n");

    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag a returned literal with no runner in it at all", () => {
    const content = ["function usage() {", '  return "usage: slopweaver cmux spawn <slug>";', "}"].join("\n");

    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });
});
