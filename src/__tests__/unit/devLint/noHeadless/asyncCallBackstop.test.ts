import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH002 — async call backstop", () => {
  it("flags a bare call to spawn/exec/execFile/fork", () => {
    const content = ["spawn(a);", "exec(b);", "execFile(c);", "fork(d);"].join("\n");
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.kind)).toEqual(["NH002", "NH002", "NH002", "NH002"]);
    expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4]);
  });

  it("does NOT flag a MEMBER call — re.exec(x) is RegExp.prototype.exec, not the child_process one", () => {
    const content = "const match = pattern.exec(body);";
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag another member call — foo.spawn(x)", () => {
    expect(scanNoHeadless({ content: "cluster.fork();", path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag an identifier that merely ENDS with the name — spawnFn(x)", () => {
    expect(scanNoHeadless({ content: 'spawnFn("claude", []);', path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag spawnSync/execSync/execFileSync as bare calls", () => {
    const content = ["spawnSync(a);", "execSync(b);", "execFileSync(c);"].join("\n");
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });
});
