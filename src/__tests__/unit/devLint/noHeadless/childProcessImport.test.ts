import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH001 — async child-process capability import", () => {
  it("flags a plain named import of spawn", () => {
    const hits = scanNoHeadless({ content: 'import { spawn } from "node:child_process";', path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH001");
    expect(hits[0]!.line).toBe(1);
  });

  it("flags each of spawn/exec/execFile/fork in one named import, and nothing else", () => {
    const content = 'import { spawn, exec, execFile, fork, execSync } from "node:child_process";';
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.excerpt)).toEqual(["spawn", "exec", "execFile", "fork"]);
    expect(hits.every((h) => h.kind === "NH001")).toBe(true);
  });

  it("does NOT flag spawnSync/execSync/execFileSync — they block the caller", () => {
    const content = 'import { spawnSync, execSync, execFileSync } from "node:child_process";';
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("flags an ALIASED import — the exact shape a bare-name regex cannot see", () => {
    const hits = scanNoHeadless({ content: 'import { spawn as s } from "node:child_process";', path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.excerpt).toBe("spawn as s");
  });

  it("flags a namespace import — banned wholly, regardless of which member is used later", () => {
    const content = 'import * as cp from "node:child_process";\nconst c = cp.spawn("x");';
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH001");
    expect(hits[0]!.line).toBe(1);
  });

  it("flags a require of child_process — banned wholly", () => {
    const hits = scanNoHeadless({ content: 'const cp = require("child_process");', path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH001");
  });

  it("flags a dynamic import of child_process — banned wholly", () => {
    const hits = scanNoHeadless({ content: 'const cp = await import("node:child_process");', path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH001");
  });

  /**
   * Found by an adversarial review pass, and verified against the real gate before the fix: the specifier
   * matcher accepted only quoted strings, so a TEMPLATE-LITERAL specifier scanned clean while starting a
   * model. NH002 could not catch it either — `cp.spawn(` is a member call, which that rule deliberately
   * excludes to avoid flagging every `RegExp.prototype.exec` in the tree. `import()` and `require()` take an
   * arbitrary expression, so a template literal is ordinary rather than exotic.
   */
  it("flags a dynamic import whose specifier is a TEMPLATE LITERAL, not just a quoted string", () => {
    const content = 'const cp = await import(`node:child_process`);\ncp.spawn("claude", ["-p"]);';
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH001");
  });

  it("flags a require() whose specifier is a template literal, for the same reason", () => {
    const hits = scanNoHeadless({ content: "const cp = require(`child_process`);", path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH001");
  });

  it("flags a MULTI-LINE named import at the line the clause closes on", () => {
    const content = ["import {", "  spawn,", '} from "node:child_process";'].join("\n");
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(3);
  });

  it("matches the bare module spelling too", () => {
    const hits = scanNoHeadless({ content: 'import { fork } from "child_process";', path: "src/x.ts" });
    expect(hits).toHaveLength(1);
  });

  it("returns no hits for a file that imports nothing from child_process", () => {
    expect(scanNoHeadless({ content: "export const x = 1;\n", path: "src/pure.ts" })).toEqual([]);
  });
});
