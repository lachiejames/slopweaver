import { describe, expect, it } from "vitest";
import { scanNoHeadless } from "../../../../devLint/noHeadless.js";

describe("NH005 — a real plist job", () => {
  it("flags a Program key in a tracked .plist file", () => {
    const content = "<plist><dict><key>Program</key><string>/bin/true</string></dict></plist>";
    const hits = scanNoHeadless({ content, path: "com.example.job.plist" });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe("NH005");
  });

  it("flags a ProgramArguments key too", () => {
    const content = "<key>ProgramArguments</key><array><string>/bin/true</string></array>";
    const hits = scanNoHeadless({ content, path: "com.example.job.plist" });
    expect(hits).toHaveLength(1);
  });

  it("does NOT flag the SAME content in a non-.plist file", () => {
    const content = "<key>Program</key><string>/bin/true</string>";
    expect(scanNoHeadless({ content, path: "src/x.ts" })).toEqual([]);
  });

  it("does NOT flag a .plist file with no job definition", () => {
    const content = "<plist><dict><key>Label</key><string>com.example.job</string></dict></plist>";
    expect(scanNoHeadless({ content, path: "com.example.job.plist" })).toEqual([]);
  });
});
