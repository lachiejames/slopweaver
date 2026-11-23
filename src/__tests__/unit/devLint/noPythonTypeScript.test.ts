/*
 * The no-python gate's TypeScript-file scanner, driven directly: a literal handed to an imported launcher is a
 * hit, a comment instruction is a hit at its real column, and a command held as data is not one.
 */
import { describe, expect, it } from "vitest";
import { scanTypeScript } from "../../../devLint/noPythonTypeScript.js";

describe("scanTypeScript", () => {
  it("reports a program literal handed to an imported launcher, with its whole hit", () => {
    const content = 'import { spawnSync } from "node:child_process";\nspawnSync("python3", []);\n';
    expect(scanTypeScript({ content, path: "src/a.ts" })).toEqual([
      { column: 10, kind: "process-call", line: 2, matchedLine: 'spawnSync("python3", []);', path: "src/a.ts" },
    ]);
  });

  it("reports a comment instruction at its real column, after every launcher hit", () => {
    const content = '  // python3 -c x\nimport { spawnSync } from "node:child_process";\nspawnSync("python3", []);\n';
    const hits = scanTypeScript({ content, path: "src/b.ts" });
    expect(hits.map((hit) => `${String(hit.line)}:${String(hit.column)} ${hit.kind} ${hit.matchedLine}`)).toEqual([
      '3:10 process-call spawnSync("python3", []);',
      "1:5 instruction // python3 -c x",
    ]);
  });

  it("leaves a command held as a string that no launcher receives", () => {
    expect(scanTypeScript({ content: 'const command = "python3 -V";\n', path: "src/c.ts" })).toEqual([]);
  });
});
