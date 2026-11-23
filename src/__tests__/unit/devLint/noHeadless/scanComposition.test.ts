import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("scanNoHeadless composition", () => {
  it("sorts findings by line", () => {
    const content = ['import { spawn } from "node:child_process";', "", "exec(x);"].join("\n");
    const hits = scanNoHeadless({ content, path: "src/x.ts" });
    expect(hits.map((h) => h.line)).toEqual([1, 3]);
  });

  it("returns no hits for an empty file", () => {
    expect(scanNoHeadless({ content: "", path: "src/x.ts" })).toEqual([]);
  });
});
