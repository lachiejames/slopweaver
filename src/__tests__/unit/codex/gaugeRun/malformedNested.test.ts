/*
 * A malformed value nested at any depth makes the Codex auth document unreadable, while legal nested primitives
 * still scan.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCodexAuth } from "../../../../codex/auth.js";
import { keyShape, scanJsonShape } from "../../../../codex/authScan.js";
import { emptyCodexHome, useGaugeRunHomes } from "./harness.js";

useGaugeRunHomes();

describe("a malformed value is rejected at EVERY depth", () => {
  // The nested half of the same finding: brace counting walked to zero over
  // `{"tokens":{"access_token":garbage}}` and reported a corrupt file as a readable signed-in state.
  it("readCodexAuth reports a nested-garbage file as unreadable, never as signed in", () => {
    const codexHome = emptyCodexHome();
    writeFileSync(join(codexHome, "auth.json"), '{"tokens":{"access_token":garbage},"auth_mode":"chatgpt"}', "utf8");
    const report = readCodexAuth({ codexHome });

    expect(report.readable).toBe(false);
    expect(report.hasTokens).toBe(false);
  });

  it("still accepts legal primitives nested at any depth", () => {
    const text = '{"tokens":{"a":true,"b":[1,-2.5,1e3,null],"c":{"d":false}},"auth_mode":"chatgpt"}';
    const scan = scanJsonShape({ captureText: new Set(["auth_mode"]), text });

    expect(scan.wellFormed).toBe(true);
    expect(keyShape({ key: "auth_mode", scan }).text).toBe("chatgpt");
    expect(keyShape({ key: "tokens", scan }).nonEmptyContainer).toBe(true);
  });
});
