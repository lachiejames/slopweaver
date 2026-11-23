/*
 * `capTableRows`: trailing table rows past the cap are dropped and counted, and a table never trims to zero rows.
 * It moved here when `truncate.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { capTableRows } from "../../../../../outbound/artifact/truncate.js";
import { paragraph, table } from "./harness.js";

describe("capTableRows", () => {
  it("drops trailing rows past the cap and reports the count dropped", () => {
    const result = capTableRows({ detail: [table({ rows: [["1"], ["2"], ["3"]] })], maxRows: 2 });

    expect(result.rowsDropped).toBe(1);
    const block = result.detail[0]!;
    expect(block.type === "table" ? block.rows.length : -1).toBe(2);
  });

  it("is a no-op when every table is already within the cap", () => {
    const detail = [table({ rows: [["1"], ["2"]] })];
    const result = capTableRows({ detail, maxRows: 2 });

    expect(result.rowsDropped).toBe(0);
    expect(result.detail).toEqual(detail);
  });

  it("leaves non-table blocks untouched", () => {
    const detail = [paragraph({ value: "hello" })];
    const result = capTableRows({ detail, maxRows: 1 });

    expect(result.rowsDropped).toBe(0);
    expect(result.detail).toEqual(detail);
  });

  it("never trims to zero rows even when maxRows itself is 0 — the zero-cap counterexample", () => {
    // A table with no rows is not a smaller table, it is a shape updateArtifactSchema's own `.min(1)`
    // refuses outright, so the effective floor is 1 regardless of how small maxRows is.
    const result = capTableRows({ detail: [table({ rows: [["1"]] })], maxRows: 0 });

    expect(result.rowsDropped).toBe(0);
    const block = result.detail[0]!;
    expect(block.type === "table" ? block.rows.length : -1).toBe(1);
  });

  it("never trims to zero rows for NaN or negative maxRows — the NaN-cap counterexample", () => {
    // Math.max(1, NaN) alone stays NaN, and [].slice(0, NaN) returns []; Number.isFinite closes that gap.
    const nanResult = capTableRows({ detail: [table({ rows: [["1"]] })], maxRows: Number.NaN });
    const negativeResult = capTableRows({ detail: [table({ rows: [["1"]] })], maxRows: -5 });
    const nanBlock = nanResult.detail[0]!;
    const negativeBlock = negativeResult.detail[0]!;

    expect(nanBlock.type === "table" ? nanBlock.rows.length : -1).toBe(1);
    expect(negativeBlock.type === "table" ? negativeBlock.rows.length : -1).toBe(1);
  });
});
