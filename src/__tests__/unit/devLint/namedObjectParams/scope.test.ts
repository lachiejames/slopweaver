/*
 * Which paths named-object-params governs (`isScopedPath`), and how `scanCoverageGaps` compares what the
 * Program loaded against what git lists.
 */
import { describe, expect, it } from "vitest";

import { isScopedPath, scanCoverageGaps } from "../../../../devLint/namedObjectParams.js";

describe("isScopedPath", () => {
  it("governs non-declaration TypeScript under src, eval and hooks", () => {
    expect(isScopedPath({ path: "src/lib/date.ts" })).toBe(true);
    expect(isScopedPath({ path: "eval/askProvider.ts" })).toBe(true);
    expect(isScopedPath({ path: "hooks/x.ts" })).toBe(true);
  });

  it("covers EVERY extension the compiler loads, including declaration and ESM/CJS variants", () => {
    // A suffix test narrower than what TypeScript loads is a blind spot, not a scoping choice: the Program
    // loads the file, the coverage check drops it before comparing against git, and an unlisted
    // `src/injected.d.mts` then slips past while the gate still prints `clean`. Measured exactly that way.
    expect(isScopedPath({ path: "src/injected.d.ts" })).toBe(true);
    expect(isScopedPath({ path: "src/injected.d.mts" })).toBe(true);
    expect(isScopedPath({ path: "src/injected.mts" })).toBe(true);
    expect(isScopedPath({ path: "src/injected.cts" })).toBe(true);
    expect(isScopedPath({ path: "src/injected.tsx" })).toBe(true);
  });

  it("ignores anything else — other directories and non-TypeScript files", () => {
    expect(isScopedPath({ path: "scripts/x.ts" })).toBe(false);
    expect(isScopedPath({ path: "src/lib/date.js" })).toBe(false);
    expect(isScopedPath({ path: "src/lib/date.mjs" })).toBe(false);
    expect(isScopedPath({ path: "README.md" })).toBe(false);
  });
});

describe("scanCoverageGaps", () => {
  it("finds nothing when the Program loaded exactly the in-scope working-tree set", () => {
    expect(scanCoverageGaps({ loaded: ["src/a.ts", "src/b.ts"], listed: ["src/b.ts", "src/a.ts"] })).toEqual({
      missing: [],
      unlisted: [],
    });
  });

  it("reports a tracked file the Program never loaded — the scan did not cover what it claims", () => {
    expect(scanCoverageGaps({ loaded: ["src/a.ts"], listed: ["src/a.ts", "src/b.ts"] })).toEqual({
      missing: ["src/b.ts"],
      unlisted: [],
    });
  });

  it("reports an in-scope file the Program loaded that git does not track", () => {
    expect(scanCoverageGaps({ loaded: ["src/a.ts", "src/scratch.ts"], listed: ["src/a.ts"] })).toEqual({
      missing: [],
      unlisted: ["src/scratch.ts"],
    });
  });

  it("reports both directions at once, each in path order", () => {
    expect(scanCoverageGaps({ loaded: ["src/z.ts", "src/b.ts"], listed: ["src/b.ts", "src/a.ts"] })).toEqual({
      missing: ["src/a.ts"],
      unlisted: ["src/z.ts"],
    });
  });

  it("treats an empty listed set as no gaps rather than an error", () => {
    expect(scanCoverageGaps({ loaded: [], listed: [] })).toEqual({ missing: [], unlisted: [] });
  });
});
