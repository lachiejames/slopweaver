/**
 * The stdout-data-channel gate, tested on inline fixtures so the gate never scans itself.
 *
 * The forbidden call is assembled from fragments rather than written whole, so this test file stays clean
 * under the very rule it exercises — a literal occurrence here would be a hit in a tracked `src/` source.
 */
import { describe, expect, it } from "vitest";

import { isScannablePath, scanStdoutDataChannel } from "../../../devLint/stdoutDataChannel.js";

/** The banned call, assembled so this file is not itself a hit. */
const BANNED = ["process", "stdout", "write"].join(".");

describe("scanStdoutDataChannel", () => {
  it("finds nothing in a verb that writes through logger.out", () => {
    const content = "out: ({ line }) => {\n  logger.out({ line });\n},\n";
    expect(scanStdoutDataChannel({ content, path: "src/cli/commands/x/run.ts" })).toEqual([]);
  });

  it("reports the line and the trimmed text of a direct stdout write", () => {
    const content = `const a = 1;\n    out: (line) => ${BANNED}(\`\${line}\\n\`),\n`;
    const hits = scanStdoutDataChannel({ content, path: "src/cli/commands/x/run.ts" });
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toBe(2);
    expect(hits[0]!.path).toBe("src/cli/commands/x/run.ts");
    expect(hits[0]!.text).toBe(`out: (line) => ${BANNED}(\`\${line}\\n\`),`);
  });

  it("reports every offending line, not only the first", () => {
    const content = `${BANNED}("a\\n");\nconst b = 2;\n${BANNED}("c\\n");\n`;
    expect(scanStdoutDataChannel({ content, path: "src/cli/commands/x/run.ts" }).map((hit) => hit.line)).toEqual([
      1, 3,
    ]);
  });

  it("finds nothing in empty content", () => {
    expect(scanStdoutDataChannel({ content: "", path: "src/cli/commands/x/run.ts" })).toEqual([]);
  });

  it("does not match a write to stderr", () => {
    const content = "err: (line) => process.stderr.write(`${line}\\n`),\n";
    expect(scanStdoutDataChannel({ content, path: "src/cli/commands/x/run.ts" })).toEqual([]);
  });
});

describe("isScannablePath", () => {
  it("scans a verb source", () => {
    expect(isScannablePath({ path: "src/cli/commands/github/pushRun.ts" })).toBe(true);
  });

  it("skips a source outside the verb surface, which is where the pipe-safe channel itself lives", () => {
    expect(isScannablePath({ path: "src/lib/logger.ts" })).toBe(false);
  });

  it("skips the progress emitter, whose non-blocking constraint the blocking channel would break", () => {
    expect(isScannablePath({ path: "src/lib/progress.ts" })).toBe(false);
  });

  it("skips a dev-lint gate, which prints its own short status lines", () => {
    expect(isScannablePath({ path: "src/devLint/houseRules.ts" })).toBe(false);
  });

  it("skips a test under the verb surface", () => {
    expect(isScannablePath({ path: "src/cli/__tests__/thing.test.ts" })).toBe(false);
  });

  it("skips a non-TypeScript file under the verb surface", () => {
    expect(isScannablePath({ path: "src/cli/commands/x/notes.md" })).toBe(false);
  });

  it("skips the gate's own source", () => {
    expect(isScannablePath({ path: "src/cli/stdoutDataChannel.ts" })).toBe(false);
  });
});
