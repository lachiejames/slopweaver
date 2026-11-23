/*
 * A malformed top-level primitive makes the Codex auth document unreadable, while every legal JSON primitive
 * still scans.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexAuth } from "../../../../codex/auth.js";
import { keyShape, scanJsonShape } from "../../../../codex/authScan.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("a malformed primitive makes the auth document unreadable, as the header promises", () => {
  // A Codex review's counterexample: `{"OPENAI_API_KEY":garbage}` walked to the closing brace and the scan
  // called it well formed, so a corrupt auth file was reported as readable with a key configured.
  it("readCodexAuth reports that file as unreadable rather than as configured", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(join(codexHome, "auth.json"), '{"OPENAI_API_KEY":garbage}', "utf8");
    const report = readCodexAuth({ codexHome });

    expect(report.readable).toBe(false);
    expect(report.hasApiKey).toBe(false);
  });

  it("still accepts every legal JSON primitive", () => {
    const scan = scanJsonShape({
      captureText: new Set(),
      text: '{"a":true,"b":false,"c":null,"d":-12.5,"e":1e3,"f":0}',
    });

    expect(scan.wellFormed).toBe(true);
    expect(keyShape({ key: "d", scan }).present).toBe(true);
  });
});
