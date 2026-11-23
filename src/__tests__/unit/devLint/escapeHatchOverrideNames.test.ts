/*
 * The escape-hatch gate's widened first criterion: an override variable OUTSIDE the `SLOPWEAVER_ALLOW_*` family
 * must have a row too. Both real cases that escaped it are here as inputs — `ALLOW_FABLE_OVERRIDE`, now a row,
 * and `SLOPWEAVER_RESPONDER_ALLOW_OPEN`, now a grant whose old variable has no business in code.
 */
import { describe, expect, it } from "vitest";
import { isScannablePath, scanEscapeHatch } from "../../../devLint/escapeHatch.js";
import { isOverrideVariableName } from "../../../devLint/overrideVariable.js";

describe("isOverrideVariableName", () => {
  it("names an upper-snake variable with an ALLOW or OVERRIDE component", () => {
    expect(isOverrideVariableName({ name: "ALLOW_FABLE_OVERRIDE" })).toBe(true);
    expect(isOverrideVariableName({ name: "SLOPWEAVER_RESPONDER_ALLOW_OPEN" })).toBe(true);
    expect(isOverrideVariableName({ name: "ACME_POLICY_OVERRIDE" })).toBe(true);
    expect(isOverrideVariableName({ name: "SLOPWEAVER_DOOR_OVERRIDE" })).toBe(true);
  });

  it("refuses a substring that is not a whole component, a single word, and anything not upper snake case", () => {
    expect(isOverrideVariableName({ name: "SLOPWEAVER_ALLOWED_HOSTS" })).toBe(false);
    expect(isOverrideVariableName({ name: "ACME_OVERRIDES_PATH" })).toBe(false);
    expect(isOverrideVariableName({ name: "ALLOW" })).toBe(false);
    expect(isOverrideVariableName({ name: "allow_fable_override" })).toBe(false);
    expect(isOverrideVariableName({ name: "SLOPWEAVER_HOME" })).toBe(false);
  });
});

describe("the escape-hatch gate on an override outside the family", () => {
  it("accepts the owner's ALLOW_FABLE_OVERRIDE, which the register now carries as fable-worker's key", () => {
    expect(
      scanEscapeHatch({ content: 'export const FABLE_OVERRIDE_ENV = "ALLOW_FABLE_OVERRIDE";', path: "src/cmux/x.ts" }),
    ).toEqual([]);
  });

  it("refuses the retired responder variable, because responder-allow-open is keyed on a grant", () => {
    const hits = scanEscapeHatch({
      content: 'const OPEN = "SLOPWEAVER_RESPONDER_ALLOW_OPEN";',
      path: "src/live/listen/whitelist.ts",
    });
    expect(hits.map((hit) => hit.message)).toEqual([
      "SLOPWEAVER_RESPONDER_ALLOW_OPEN has no row in src/hatch/registry.ts — every escape hatch is declared once, with its command and its legitimate exceptions",
    ]);
  });

  it("refuses an unregistered override quoted in an env index", () => {
    const hits = scanEscapeHatch({ content: "const open = env['ACME_ALLOW_EVERYONE'] === \"1\";", path: "src/a.ts" });
    expect(hits.map((hit) => hit.criterion)).toEqual(["undeclared"]);
    expect(hits[0]!.message).toContain("ACME_ALLOW_EVERYONE has no row");
  });

  it("refuses an unregistered override read as a bare process.env property", () => {
    const hits = scanEscapeHatch({
      content: 'const open = process.env.ACME_POLICY_OVERRIDE === "1";',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => hit.message.split(" ")[0])).toEqual(["ACME_POLICY_OVERRIDE"]);
  });

  it("refuses an unregistered override assembled from a + chain of literals", () => {
    const hits = scanEscapeHatch({
      content: 'export function open(): boolean { return process.env["ACME_POLICY_" + "OVERRIDE"] === "1"; }',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([
      ["undeclared", "ACME_POLICY_OVERRIDE"],
    ]);
  });

  it("refuses an unregistered override written as an import attribute key", () => {
    const hits = scanEscapeHatch({
      content: 'import data from "./data.json" with { ACME_ALLOW_GHOST: "1" };',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([["undeclared", "ACME_ALLOW_GHOST"]]);
  });

  it("refuses an unregistered override declared as a constructor parameter property", () => {
    const hits = scanEscapeHatch({
      content: "class C { constructor(public ACME_ALLOW_UNDECLARED: string) {} }",
      path: "src/a.ts",
    });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([
      ["undeclared", "ACME_ALLOW_UNDECLARED"],
    ]);
  });

  it("refuses an unregistered override written as a JSX attribute in a .tsx file", () => {
    const hits = scanEscapeHatch({
      content: 'const view = <Widget ACME_ALLOW_UNDECLARED="1" />;',
      path: "src/feature/View.tsx",
    });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([
      ["undeclared", "ACME_ALLOW_UNDECLARED"],
    ]);
  });

  it("refuses an unregistered override folded from a string and a number", () => {
    const hits = scanEscapeHatch({ content: 'const open = process.env["ACME_ALLOW_" + 1] === "1";', path: "src/a.ts" });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([["undeclared", "ACME_ALLOW_1"]]);
  });

  it("reads a registered name written with an escape as that name", () => {
    const content = 'const x = "SLOPWEAVER_ALLOW_PO\\u004cL";';
    expect(content).toContain("\\u004c");
    expect(scanEscapeHatch({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("reads a registered name split across a literal chain as that name", () => {
    expect(scanEscapeHatch({ content: 'const x = "SLOPWEAVER_ALLOW_" + "POLL";', path: "src/a.ts" })).toEqual([]);
  });

  it("still refuses an unregistered family mention that an escape follows inside a longer string", () => {
    const hits = scanEscapeHatch({ content: String.raw`const x = "set SLOPWEAVER_ALLOW_GHOST\n";`, path: "src/a.ts" });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([
      ["undeclared", "SLOPWEAVER_ALLOW_GHOST"],
    ]);
  });

  it("keeps the syntax tree's lines and the scan's in step under CR-only breaks", () => {
    const hits = scanEscapeHatch({ content: 'const ok = 0;\rconst x = "ACME_ALLOW_GHOST";', path: "src/a.ts" });
    expect(hits.map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([[2, "ACME_ALLOW_GHOST"]]);
  });

  it("refuses an unregistered override introduced by a re-export alias", () => {
    const hits = scanEscapeHatch({ content: 'export { x as ACME_ALLOW_GHOST } from "./x.js";', path: "src/a.ts" });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([["undeclared", "ACME_ALLOW_GHOST"]]);
  });

  it("refuses an unregistered override introduced by a namespace re-export", () => {
    const hits = scanEscapeHatch({ content: 'export * as ACME_ALLOW_GHOST from "./x.js";', path: "src/a.ts" });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([["undeclared", "ACME_ALLOW_GHOST"]]);
  });

  it("leaves a plain re-export, and an import's source side, to the module that declares the name", () => {
    const content = [
      'export { ACME_ALLOW_GHOST } from "./x.js";',
      'export { ACME_ALLOW_GHOST as ghost } from "./x.js";',
      'import { ACME_ALLOW_GHOST as other } from "./x.js";',
      'import { "ACME_ALLOW_GHOST" as quoted } from "./x.js";',
      'export { "ACME_ALLOW_GHOST" } from "./x.js";',
    ].join("\n");
    expect(scanEscapeHatch({ content, path: "src/a.ts" })).toEqual([]);
  });

  it("still refuses a quoted alias, which is a new name", () => {
    const hits = scanEscapeHatch({
      content: 'export { ghost as "ACME_ALLOW_GHOST" } from "./x.js";',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([["undeclared", "ACME_ALLOW_GHOST"]]);
  });

  it("folds through a type-level wrapper in a chain or a template hole", () => {
    const content = [
      'const a = "ACME_A" + ("LLOW_GHOST" as const);',
      'const b = `ACME_A${"LLOW_GHOST" as const}`;',
      'const c = "ACME_A" + ("LLOW_GHOST" satisfies string);',
      'const d = "ACME_A" + <string>"LLOW_GHOST";',
      'const e = "ACME_A" + "LLOW_GHOST"!;',
    ].join("\n");
    const hits = scanEscapeHatch({ content, path: "src/a.ts" });
    expect(hits.map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([
      [1, "ACME_ALLOW_GHOST"],
      [2, "ACME_ALLOW_GHOST"],
      [3, "ACME_ALLOW_GHOST"],
      [4, "ACME_ALLOW_GHOST"],
      [5, "ACME_ALLOW_GHOST"],
    ]);
  });

  it("reads an import type's member as a named key even beside a same-named local", () => {
    const content = [
      "const ACME_ALLOW_GHOST = 1;",
      'type T = import("./x").ACME_ALLOW_GHOST;',
      'type U = import("./x").ACME_ALLOW_GHOST.ACME_ALLOW_INNER;',
    ].join("\n");
    const hits = scanEscapeHatch({ content, path: "src/a.ts" });
    expect(hits.map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([
      [2, "ACME_ALLOW_GHOST"],
      [3, "ACME_ALLOW_GHOST"],
      [3, "ACME_ALLOW_INNER"],
    ]);
  });

  it("refuses an export alias even beside a same-named local", () => {
    const content = [
      "const ACME_ALLOW_GHOST = 1;",
      'export { x as ACME_ALLOW_GHOST } from "./x.js";',
      'export * as ACME_ALLOW_GHOST from "./x.js";',
      "export { y as ACME_ALLOW_GHOST };",
    ].join("\n");
    const hits = scanEscapeHatch({ content, path: "src/a.ts" });
    expect(hits.map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([
      [2, "ACME_ALLOW_GHOST"],
      [3, "ACME_ALLOW_GHOST"],
      [4, "ACME_ALLOW_GHOST"],
    ]);
  });

  it("refuses a namespaced JSX attribute key even beside a same-named local", () => {
    const content = ["const ACME_ALLOW_GHOST = 1;", 'const view = <Widget ns:ACME_ALLOW_GHOST="1" />;'].join("\n");
    const hits = scanEscapeHatch({ content, path: "src/feature/View.tsx" });
    expect(hits.map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([[2, "ACME_ALLOW_GHOST"]]);
  });

  it("reports a parameter property where it is declared, never a later use of that local", () => {
    const content = [
      "class C {",
      "  constructor(public ACME_ALLOW_GHOST: string) {",
      "    consume(ACME_ALLOW_GHOST);",
      "  }",
      "}",
    ].join("\n");
    const hits = scanEscapeHatch({ content, path: "src/a.ts" });
    expect(hits.map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([[2, "ACME_ALLOW_GHOST"]]);
  });

  it("reads a parameter property only on a constructor, never a modifier on another function's parameter", () => {
    expect(
      scanEscapeHatch({ content: "function f(readonly ACME_ALLOW_GHOST: string): void {}", path: "src/a.ts" }),
    ).toEqual([]);
  });

  it("keeps a raw family fragment that a longer name in ANOTHER literal on the line starts with", () => {
    const hits = scanEscapeHatch({
      content: 'const a = "note SLOPWEAVER_ALLOW_P"; const b = "SLOPWEAVER_ALLOW_POLL";',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => [hit.criterion, hit.message.split(" ")[0]])).toEqual([
      ["undeclared", "SLOPWEAVER_ALLOW_P"],
    ]);
  });

  it("reports one hit for a name spelled twice on a line", () => {
    const hits = scanEscapeHatch({
      content: 'const x = process.env.ACME_ALLOW_X ?? process.env["ACME_ALLOW_X"];',
      path: "src/a.ts",
    });
    expect(hits.length).toBe(1);
  });

  it("leaves the door's own list variable to the door-token criterion", () => {
    expect(
      scanEscapeHatch({ content: 'const raw = process.env["SLOPWEAVER_DOOR_OVERRIDE"];', path: "src/admit/x.ts" }),
    ).toEqual([]);
  });

  it("ignores an ordinary setting and an override named only in a comment", () => {
    expect(scanEscapeHatch({ content: 'const home = process.env["SLOPWEAVER_HOME"];', path: "src/a.ts" })).toEqual([]);
    expect(scanEscapeHatch({ content: '// set "ACME_ALLOW_EVERYONE" to open it', path: "src/a.ts" })).toEqual([]);
  });

  it("reads the code after a block comment that closes on the same line, which a whole-line skip let past", () => {
    const hits = scanEscapeHatch({
      content: '/* policy */ const open = process.env.ACME_POLICY_OVERRIDE === "1";',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => hit.message.split(" ")[0])).toEqual(["ACME_POLICY_OVERRIDE"]);
  });

  it("reads the code after a doc comment's closing line, and nothing inside a block comment still open", () => {
    const content = [
      "/**",
      ' * set "ACME_ALLOW_EVERYONE" to open it',
      ' */ const open = env["ACME_ALLOW_EVERYONE"];',
    ].join("\n");
    expect(scanEscapeHatch({ content, path: "src/a.ts" }).map((hit) => hit.line)).toEqual([3]);
  });

  it("reads a generator method whose line starts with `*`, which a comment-shape guess took for prose", () => {
    const content = ["const readers = {", "  *values() { return process.env.ACME_POLICY_OVERRIDE; }", "};"].join("\n");
    expect(scanEscapeHatch({ content, path: "src/a.ts" }).map((hit) => hit.line)).toEqual([2]);
  });

  it("finds a process.env access wrapped across two lines, on the line its name starts", () => {
    const content = ["const open =", "  process.env", '    .ACME_POLICY_OVERRIDE === "1";'].join("\n");
    expect(scanEscapeHatch({ content, path: "src/a.ts" }).map((hit) => [hit.line, hit.message.split(" ")[0]])).toEqual([
      [3, "ACME_POLICY_OVERRIDE"],
    ]);
  });

  it("refuses a parenthesised process.env read, because the receiver is never what decides", () => {
    const hits = scanEscapeHatch({
      content: 'const open = (process.env).ACME_POLICY_OVERRIDE === "1";',
      path: "src/a.ts",
    });
    expect(hits.map((hit) => hit.message.split(" ")[0])).toEqual(["ACME_POLICY_OVERRIDE"]);
  });

  it("refuses an override read by assignment destructuring, which the parser holds as an object literal", () => {
    const hits = scanEscapeHatch({
      content: "let open; ({ ACME_ALLOW_UNDECLARED: open } = process.env);",
      path: "src/a.ts",
    });
    expect(hits.map((hit) => hit.message.split(" ")[0])).toEqual(["ACME_ALLOW_UNDECLARED"]);
  });

  it("scans the desktop shell's source, where the fleet page names ALLOW_FABLE_OVERRIDE", () => {
    expect(isScannablePath({ path: "desktop/src/fleetHealth.ts" })).toBe(true);
  });

  it("skips only its own files by exact path, so a same-named file elsewhere cannot hide an override", () => {
    expect(isScannablePath({ path: "src/devLint/escapeHatch.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/escapeHatch.entry.ts" })).toBe(false);
    expect(isScannablePath({ path: "desktop/src/escapeHatch.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/hatch/escapeHatch.ts" })).toBe(true);
  });

  it("holds the register file to the same rule, since its prose naming the family is now blanked as comment", () => {
    const hits = scanEscapeHatch({ content: 'const ghost = "ACME_ALLOW_GHOST";', path: "src/hatch/registry.ts" });
    expect(hits.map((hit) => hit.message.split(" ")[0])).toEqual(["ACME_ALLOW_GHOST"]);
  });

  it("scans a .tsx file and parses its JSX, so an override in a component is refused too", () => {
    expect(isScannablePath({ path: "src/feature/Break.tsx" })).toBe(true);
    const hits = scanEscapeHatch({
      content: 'export const hatch = "ACME_ALLOW_UNDECLARED"; export const View = () => <div />;',
      path: "src/feature/Break.tsx",
    });
    expect(hits.map((hit) => hit.message.split(" ")[0])).toEqual(["ACME_ALLOW_UNDECLARED"]);
  });
});
