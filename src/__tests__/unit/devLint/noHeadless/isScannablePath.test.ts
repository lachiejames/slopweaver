import { describe, expect, it } from "vitest";
import { isScannablePath } from "../../../../devLint/noHeadless.js";

describe("isScannablePath", () => {
  it("accepts a non-test production source under src/", () => {
    expect(isScannablePath({ path: "src/llm/claudeCli.ts" })).toBe(true);
  });

  it("accepts the plugin's shell/launcher/eval surface regardless of extension", () => {
    expect(isScannablePath({ path: "bin/slopweaver" })).toBe(true);
    expect(isScannablePath({ path: "scripts/check-hygiene.sh" })).toBe(true);
    expect(isScannablePath({ path: "hooks/hooks.json" })).toBe(true);
    expect(isScannablePath({ path: "eval/askProvider.ts" })).toBe(true);
  });

  it("accepts a tracked .plist file anywhere", () => {
    expect(isScannablePath({ path: "com.example.job.plist" })).toBe(true);
  });

  it("rejects a test file", () => {
    expect(isScannablePath({ path: "src/llm/claudeCli.test.ts" })).toBe(false);
  });

  it("rejects a fixture", () => {
    expect(isScannablePath({ path: "eval/fixtures/corpus.bronze.jsonl" })).toBe(false);
  });

  it("rejects a recorded cassette", () => {
    expect(isScannablePath({ path: "src/__tests__/integration/__recordings__/x/recording.har" })).toBe(false);
  });

  it("rejects Markdown/docs", () => {
    expect(isScannablePath({ path: "AGENTS.md" })).toBe(false);
    expect(isScannablePath({ path: "skills/loop/SKILL.md" })).toBe(false);
  });

  it("rejects this gate's own files", () => {
    expect(isScannablePath({ path: "src/devLint/noHeadless.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/noHeadless.entry.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/__tests__/unit/devLint/noHeadless/isScannablePath.test.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/noHeadlessCapability.ts" })).toBe(false);
  });

  it("does not exempt a same-named file in another tree — the gate's own files are exact paths", () => {
    expect(isScannablePath({ path: "desktop/src/noHeadless.ts" })).toBe(true);
    expect(isScannablePath({ path: "tools/noHeadlessCapability.ts" })).toBe(true);
    expect(isScannablePath({ path: "site/lib/noHeadless.entry.ts" })).toBe(true);
  });

  it("rejects a source outside the scanned directories", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
    expect(isScannablePath({ path: "templates/whatever.ts" })).toBe(false);
  });
});
