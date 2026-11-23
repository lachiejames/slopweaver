/*
 * `parseCoverageSummary`: a V8 summary becomes rounded totals and per-directory statements, and every shape that
 * would let a partial or empty report clear the floor is refused with a typed error.
 */
import { describe, expect, it } from "vitest";

import { parseCoverageSummary } from "../../../../devLint/coverageFloor.js";
import { CoverageFloorErrors } from "../../../../devLint/coverageFloorErrors.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { ROOT } from "./harness.js";

/** One per-file summary entry as V8 writes it, keyed by absolute path. */
const fileEntry = ({ covered, total }: { covered: number; total: number }): Record<string, unknown> => ({
  statements: { covered, pct: total === 0 ? 0 : (100 * covered) / total, skipped: 0, total },
});

const summaryJson = ({
  b,
  f,
  l,
  s,
  files = {},
}: {
  b: number;
  f: number;
  l: number;
  s: number;
  files?: Record<string, { covered: number; total: number }>;
}): string =>
  JSON.stringify({
    total: {
      branches: { pct: b },
      functions: { pct: f },
      lines: { pct: l },
      statements: { pct: s },
    },
    ...Object.fromEntries(Object.entries(files).map(([path, counts]) => [`${ROOT}/${path}`, fileEntry(counts)])),
  });

describe("parseCoverageSummary", () => {
  it("extracts the four rounded total percentages and the per-directory statements", () => {
    const result = parseCoverageSummary({
      root: ROOT,
      text: summaryJson({
        b: 80.005,
        f: 90,
        files: { "src/cli/a.ts": { covered: 1, total: 4 }, "src/lib/b.ts": { covered: 3, total: 3 } },
        l: 88.1,
        s: 87,
      }),
    });
    expect(result.isOk()).toBe(true);
    expect(unwrap(result)).toEqual({
      directories: {
        "src/cli": { statementCount: 4, statements: 25 },
        "src/lib": { statementCount: 3, statements: 100 },
      },
      reportedFiles: ["src/cli/a.ts", "src/lib/b.ts"],
      summary: { branches: 80.01, functions: 90, lines: 88.1, statements: 87 },
    });
  });

  it("tolerates a root given with a trailing slash", () => {
    const result = parseCoverageSummary({
      root: `${ROOT}/`,
      text: summaryJson({ b: 1, f: 1, files: { "src/cli/a.ts": { covered: 1, total: 1 } }, l: 1, s: 1 }),
    });
    expect(unwrap(result).directories).toEqual({ "src/cli": { statementCount: 1, statements: 100 } });
  });

  it("errors on malformed JSON", () => {
    const result = parseCoverageSummary({ root: ROOT, text: "{bad" });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe("coverage summary: invalid JSON");
  });

  it("errors on an unexpected shape", () => {
    const result = parseCoverageSummary({ root: ROOT, text: JSON.stringify({ total: { lines: { pct: 1 } } }) });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toBe(
      "coverage summary: unexpected shape (expected total.{branches,functions,lines,statements}.pct)",
    );
  });

  it("errors on a file entry outside the root rather than dropping it — a dropped file is a floorless directory", () => {
    const text = JSON.stringify({
      "/elsewhere/src/cli/a.ts": fileEntry({ covered: 1, total: 1 }),
      total: { branches: { pct: 1 }, functions: { pct: 1 }, lines: { pct: 1 }, statements: { pct: 1 } },
    });
    const result = parseCoverageSummary({ root: ROOT, text });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result)).toEqual(
      CoverageFloorErrors.summaryFileEntryOutsideRoot({ path: "/elsewhere/src/cli/a.ts", root: "/repo/" }),
    );
  });

  it("errors on totals with no per-file entry under them, rather than letting them clear the floor", () => {
    const result = parseCoverageSummary({ root: ROOT, text: summaryJson({ b: 99, f: 99, l: 99, s: 99 }) });
    expect(unwrapErr(result)).toEqual(
      CoverageFloorErrors.summaryMalformed({ detail: "measured no statement in any file, so it measured nothing" }),
    );
  });

  it("errors on file entries that measured zero statements, which a bare entry count let through", () => {
    const result = parseCoverageSummary({
      root: ROOT,
      text: summaryJson({ b: 99, f: 99, files: { "src/empty.ts": { covered: 0, total: 0 } }, l: 99, s: 99 }),
    });
    expect(unwrapErr(result)).toEqual(
      CoverageFloorErrors.summaryMalformed({ detail: "measured no statement in any file, so it measured nothing" }),
    );
  });

  it("errors on a file entry without statement counts", () => {
    const text = JSON.stringify({
      [`${ROOT}/src/cli/a.ts`]: { lines: { pct: 1 } },
      total: { branches: { pct: 1 }, functions: { pct: 1 }, lines: { pct: 1 }, statements: { pct: 1 } },
    });
    const result = parseCoverageSummary({ root: ROOT, text });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("SUMMARY_FILE_ENTRY");
    expect(unwrapErr(result).message).toBe(
      "coverage summary: file entry /repo/src/cli/a.ts lacks statements.{covered,total}",
    );
  });

  it("errors on a negative statement count, which measured nothing yet passed a zero test", () => {
    const text = summaryJson({ b: 99, f: 99, files: { "src/empty.ts": { covered: -1, total: -1 } }, l: 99, s: 99 });
    const result = parseCoverageSummary({ root: ROOT, text });
    expect(unwrapErr(result).code).toBe("SUMMARY_FILE_ENTRY");
    expect(unwrapErr(result).message).toBe(
      "coverage summary: file entry /repo/src/empty.ts lacks statements.{covered,total}",
    );
  });
});
