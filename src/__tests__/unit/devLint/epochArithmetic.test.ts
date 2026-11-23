/**
 * The epoch-arithmetic gate's criterion: a `new Date()` whose sole argument is a multiplication.
 *
 * The negative cases matter more than the positive one here — the gate ships with no allowlist, so a shape
 * it wrongly flags has no escape hatch at all.
 */
import { describe, expect, it } from "vitest";

import { isScannablePath, scanEpochArithmetic } from "../../../devLint/epochArithmetic.js";

// register-class: slack-ts-hand-converted-to-iso (docs/recurring-failure-register/bindings.md)

/** Scan a snippet as an ordinary source file. */
function hits({ content }: { content: string }): readonly string[] {
  return scanEpochArithmetic({ content, path: "src/example.ts" }).map((hit) => `${String(hit.line)}`);
}

describe("scanEpochArithmetic", () => {
  it("flags the scaled-epoch shape every duplicate conversion was written in", () => {
    expect(hits({ content: "const iso = new Date(seconds * 1000).toISOString();\n" })).toEqual(["1"]);
  });

  it("flags it with the factor on the left, which reads identically to a compiler", () => {
    expect(hits({ content: "const d = new Date(1000 * seconds);\n" })).toEqual(["1"]);
  });

  it("flags it through parentheses, so wrapping is not an escape hatch", () => {
    expect(hits({ content: "const d = new Date((seconds * MS_PER_SECOND));\n" })).toEqual(["1"]);
  });

  it("leaves a plain millisecond value alone — there is no arithmetic to get wrong", () => {
    expect(hits({ content: "const d = new Date(ms);\n" })).toEqual([]);
  });

  it("leaves a window bound alone: its top-level operator is subtraction, not scaling", () => {
    expect(hits({ content: "const d = new Date(now.getTime() - days * 86_400_000);\n" })).toEqual([]);
  });

  it("leaves the zero-argument and ISO-string constructions alone", () => {
    expect(hits({ content: 'const a = new Date();\nconst b = new Date("2026-08-31T23:56:19Z");\n' })).toEqual([]);
  });

  it("exempts the two modules every other file is routed through", () => {
    const content = "const d = new Date(seconds * 1000);\n";
    expect(scanEpochArithmetic({ content, path: "src/lib/date.ts" })).toEqual([]);
    expect(scanEpochArithmetic({ content, path: "src/lib/slackTs.ts" })).toEqual([]);
  });

  it("names the canonical destinations in its refusal, so the fix needs no second lookup", () => {
    const message = scanEpochArithmetic({ content: "new Date(s * 1000);\n", path: "src/x.ts" })[0]!.message;
    expect(message).toContain("epochSecondsToIso");
    expect(message).toContain("slackTsToIso");
  });
});

describe("isScannablePath", () => {
  it("covers the three trees AGENTS.md path-scopes the TypeScript rules to", () => {
    expect(isScannablePath({ path: "src/live/slack/document.ts" })).toBe(true);
    expect(isScannablePath({ path: "eval/rerankArmRun.ts" })).toBe(true);
    expect(isScannablePath({ path: "hooks/pretooluse.ts" })).toBe(true);
  });

  it("scans tests too, because the assertions that recompute an epoch are the same class", () => {
    expect(isScannablePath({ path: "src/__tests__/unit/lib/date.test.ts" })).toBe(true);
  });

  it("never scans its own files", () => {
    expect(isScannablePath({ path: "src/devLint/epochArithmetic.ts" })).toBe(false);
    expect(isScannablePath({ path: "src/devLint/epochArithmetic.entry.ts" })).toBe(false);
  });

  it("ignores documentation and configuration", () => {
    expect(isScannablePath({ path: "docs/architecture.md" })).toBe(false);
    expect(isScannablePath({ path: "package.json" })).toBe(false);
  });
});
