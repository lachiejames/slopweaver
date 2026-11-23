/**
 * The cli-command-boundary gate's criterion: a product module's static import, import-equals or re-export resolving under
 * `src/cli/commands/`.
 *
 * The negative cases carry as much weight as the positive ones — the gate ships with no allowlist, so a shape
 * it wrongly flags has no escape hatch at all.
 */
import { describe, expect, it } from "vitest";

import { isScannablePath, scanCliCommandBoundary } from "../../../devLint/cliCommandBoundary.js";

/** Scan a snippet as though it sat at `path`, answering each hit's line. */
function lines({ content, path }: { content: string; path: string }): readonly number[] {
  return scanCliCommandBoundary({ content, path }).map((hit) => hit.line);
}

describe("scanCliCommandBoundary", () => {
  it("flags a product module's relative import of a verb module", () => {
    const content = 'import { x } from "../../cli/commands/github/pushCore.js";\n';
    expect(lines({ content, path: "src/live/listen/recover.ts" })).toEqual([1]);
  });

  it("flags a type-only import, which still ties the two trees together", () => {
    const content = 'import type { X } from "../cli/commands/slack/wiring.js";\n';
    expect(lines({ content, path: "src/admit/door.ts" })).toEqual([1]);
  });

  it("flags an import-equals require, value or type-only, which is the same edge in CommonJS spelling", () => {
    const content =
      'import PushCore = require("../cli/commands/github/pushCore.js");\n' +
      'import type Wiring = require("../cli/commands/slack/wiring.js");\n';
    expect(lines({ content, path: "src/admit/x.ts" })).toEqual([1, 2]);
  });

  it("flags a re-export, which is the same edge spelled as a barrel", () => {
    const content = 'export { x } from "../cli/commands/refresh/core.js";\n';
    expect(lines({ content, path: "src/corpus/index.ts" })).toEqual([1]);
  });

  it("names the resolved verb module in its message, so the fix needs no second lookup", () => {
    const content = 'import { x } from "../../cli/commands/github/pushCore.js";\n';
    const hit = scanCliCommandBoundary({ content, path: "src/live/listen/recover.ts" })[0]!;
    expect(hit.message).toContain("`src/cli/commands/github/pushCore.ts`");
  });

  it("reports the line of each offending declaration, in source order", () => {
    const content = [
      'import { a } from "../lib/a.js";',
      'import { b } from "../cli/commands/b.js";',
      'import { c } from "../lib/c.js";',
      'export * from "../cli/commands/d.js";',
      "",
    ].join("\n");
    expect(lines({ content, path: "src/admit/x.ts" })).toEqual([2, 4]);
  });

  it("leaves a file under src/cli alone, because that tree is the verb surface", () => {
    const content = 'import { x } from "../commands/github/pushCore.js";\n';
    expect(lines({ content, path: "src/cli/manifests/github.ts" })).toEqual([]);
  });

  it("leaves a test file and the test tree alone, so the criterion holds without the runner's scope", () => {
    const content = 'import { x } from "../cli/commands/github/pushCore.js";\n';
    expect(lines({ content, path: "src/live/recover.test.ts" })).toEqual([]);
    expect(
      lines({ content: 'import { x } from "../../cli/commands/a.js";\n', path: "src/__tests__/unit/a.ts" }),
    ).toEqual([]);
  });

  it("leaves an import of src/cli outside commands alone — only the verb modules are the boundary", () => {
    const content = 'import { EXIT_USAGE } from "../cli/exitCodes.js";\n';
    expect(lines({ content, path: "src/admit/x.ts" })).toEqual([]);
  });

  it("leaves a dynamic import() thunk alone, the criterion's named blind spot", () => {
    const content = 'const load = () => import("../cli/commands/atlas/run.js");\n';
    expect(lines({ content, path: "src/atlas/registration.ts" })).toEqual([]);
  });

  it("leaves a bare package specifier alone, even one spelled like the tree", () => {
    const content = 'import { x } from "cli/commands";\n';
    expect(lines({ content, path: "src/admit/x.ts" })).toEqual([]);
  });

  it("leaves a local export with no module specifier alone", () => {
    expect(lines({ content: "const a = 1;\nexport { a };\n", path: "src/admit/x.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans a product source file", () => {
    expect(isScannablePath({ path: "src/live/listen/recover.ts" })).toBe(true);
  });

  it("skips a test file and the test tree", () => {
    expect(isScannablePath({ path: "src/live/listen/recover.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/live/listen/recover.ts" })).toBe(false);
  });

  it("skips a file outside src", () => {
    expect(isScannablePath({ path: "eval/run.ts" })).toBe(false);
  });

  it("judges the gate's own source and entry point, and any same-named file elsewhere", () => {
    expect(isScannablePath({ path: "src/devLint/cliCommandBoundary.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/devLint/cliCommandBoundary.entry.ts" })).toBe(true);
    expect(isScannablePath({ path: "src/admit/cliCommandBoundary.ts" })).toBe(true);
  });
});
