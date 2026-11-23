/*
 * `verdictAfterScan`: the diagnostics are consulted only when the scan found something, and only about the
 * files carrying a finding; and why that is sound, since an unresolved import errs toward a violation.
 */
import { describe, expect, it, vi } from "vitest";

import type { NamedObjectParamsViolation } from "../../../../devLint/namedObjectParams.js";
import { verdictAfterScan } from "../../../../devLint/namedObjectParamsVerdict.js";
import { scanFixture } from "./harness.js";

/** Every case builds a real Program over the full ESNext lib: the same fixed cost `optionsObject.test.ts` names. */
vi.setConfig({ testTimeout: 60_000 });

/**
 * The 926 MiB property, as a test rather than as a paragraph.
 *
 * `verdictAfterScan` takes the Program's diagnostics as a THUNK precisely so that not calling it is
 * observable, and the seam here is a plain counting closure — not a mock. A test that only asserted the
 * three endings would pass identically if the expensive pass ran on every run, which is the defect this
 * whole change removes.
 */
describe("verdictAfterScan", () => {
  const violation: NamedObjectParamsViolation = {
    line: 7,
    name: "bronzeFile",
    path: "/repo/src/a.ts",
    rule: "arity",
    signature: "(source: string, window: string)",
  };

  it("does not consult the diagnostics at all when the scan is clean", () => {
    let calls = 0;
    const verdict = verdictAfterScan({
      diagnosticsIfNeeded: () => {
        calls += 1;
        return [];
      },
      violations: [],
    });
    expect(verdict.kind).toBe("clean");
    expect(calls).toBe(0);
  });

  it("consults them exactly once when the scan found a violation", () => {
    let calls = 0;
    const verdict = verdictAfterScan({
      diagnosticsIfNeeded: () => {
        calls += 1;
        return [];
      },
      violations: [violation],
    });
    expect(verdict.kind).toBe("violations");
    expect(calls).toBe(1);
  });

  // The whole-repo pass this replaces did not fit under the 8,192 MiB ceiling, so every real finding died
  // as a V8 heap FATAL. What it is asked about is the property: the violating files, each once, nothing else.
  it("asks only about the distinct files carrying a finding", () => {
    const asked: (readonly string[])[] = [];
    verdictAfterScan({
      diagnosticsIfNeeded: ({ paths }) => {
        asked.push(paths);
        return [];
      },
      violations: [
        violation,
        { ...violation, line: 19, name: "silverFile" },
        { ...violation, line: 3, name: "goldFile", path: "/repo/src/b.ts" },
      ],
    });
    expect(asked).toEqual([["/repo/src/a.ts", "/repo/src/b.ts"]]);
  });

  it("carries the violations through when the types were sound", () => {
    const verdict = verdictAfterScan({ diagnosticsIfNeeded: () => [], violations: [violation] });
    expect(verdict).toEqual({ kind: "violations", violations: [violation] });
  });

  it("refuses the verdict instead of reporting violations the diagnostics make untrustworthy", () => {
    const verdict = verdictAfterScan({
      diagnosticsIfNeeded: () => ["  TS2307 src/a.ts:3: Cannot find module './gone'."],
      violations: [violation],
    });
    expect(verdict).toEqual({
      diagnostics: ["  TS2307 src/a.ts:3: Cannot find module './gone'."],
      kind: "untrustworthy",
    });
  });
});

/**
 * The reason the test above is allowed to exist: an unresolved import cannot make a NON-COMPLIANT signature
 * read compliant, so a clean scan never needed the diagnostics. `ts.TypeFlags.Any` is in `PRIMITIVE_FLAGS`,
 * and an error type is an `any` by flags, so `isOptionsObject` returns false and the signature is REPORTED.
 * This is the falsifiable half of the argument in `namedObjectParams.ts`'s header — it fails if a future
 * change makes an unresolvable parameter type read as a bag.
 */
describe("an unresolved import errs toward a violation, never toward a clean scan", () => {
  it("reports a sole parameter whose type comes from a module that does not exist", () => {
    const { violations } = scanFixture({
      source: [
        `import type { Options } from "./nowhere.js";`,
        `export function redactText(options: Options): string {`,
        `  return String(options);`,
        `}`,
      ].join("\n"),
    });
    expect(violations.map((v) => v.rule)).toEqual(["not-an-options-object"]);
    expect(violations[0]!.name).toBe("redactText");
  });
});
