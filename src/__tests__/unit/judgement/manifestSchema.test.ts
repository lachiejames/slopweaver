/** The source-manifest schema: what it admits, the copy it returns, and the exact issue lines it refuses with. */
import { describe, expect, it } from "vitest";

import { parseSourceManifest } from "../../../judgement/manifestSchema.js";
import { JUDGEMENT_SELECTION_CONTRACT } from "../../../judgement/sourceSelection.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

const ROW = {
  contentHash: `sha256:${"b".repeat(64)}`,
  coverage: {
    budgetSkippedFiles: 0,
    candidateChars: 10,
    candidateFiles: 1,
    contract: JUDGEMENT_SELECTION_CONTRACT,
    selectedChars: 10,
    selectedFiles: 1,
    strata: [{ candidateFiles: 1, selectedFiles: 1, stratum: "." }],
    truncatedFiles: 0,
  },
  fileCount: 1,
  label: "test-source",
  selected: [
    {
      candidateChars: 10,
      contentHash: `sha256:${"c".repeat(64)}`,
      relativePath: "a.md",
      selectedChars: 10,
      truncated: false,
    },
  ],
};

describe("parseSourceManifest", () => {
  it("admits an empty manifest and a well-formed row", () => {
    expect(unwrap(parseSourceManifest({ value: [] }))).toEqual([]);
    expect(unwrap(parseSourceManifest({ value: [ROW] }))).toEqual([ROW]);
  });

  it("returns its own copy, so a later re-read of the input cannot reach what is hashed", () => {
    let reads = 0;
    const row = {
      ...ROW,
      get fileCount(): number {
        reads += 1;
        return reads === 1 ? 1 : Number.NaN;
      },
    };
    const parsed = unwrap(parseSourceManifest({ value: [row] }));
    expect(Number.isNaN(row.fileCount)).toBe(true);
    expect(parsed[0]!.fileCount).toBe(1);
  });

  it("refuses negative zero by name, at its path", () => {
    expect(
      unwrapErr(parseSourceManifest({ value: [{ ...ROW, coverage: { ...ROW.coverage, truncatedFiles: -0 } }] })),
    ).toEqual(["0.coverage.truncatedFiles: a count is never negative zero"]);
  });

  it("refuses a field the scan never writes", () => {
    expect(unwrapErr(parseSourceManifest({ value: [{ ...ROW, extra: 1 }] }))).toEqual(['0: Unrecognized key: "extra"']);
  });

  it("refuses a value that is not a manifest at all", () => {
    expect(unwrapErr(parseSourceManifest({ value: "not a manifest" }))).toEqual([
      ": Invalid input: expected array, received string",
    ]);
  });
});
