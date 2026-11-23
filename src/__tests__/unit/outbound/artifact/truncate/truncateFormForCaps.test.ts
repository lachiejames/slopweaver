/*
 * `truncateFormForCaps`: one call caps the detail and the index independently and reports whether either half
 * dropped anything. It moved here when `truncate.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { truncateFormForCaps } from "../../../../../outbound/artifact/truncate.js";
import { paragraph, text } from "./harness.js";

describe("truncateFormForCaps", () => {
  it("is a full no-op when nothing is over any cap", () => {
    const detail = [paragraph({ value: "hello" })];
    const index = [[text({ value: "one" })]];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "body",
      index,
      leadLength: 5,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 5 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.detail).toEqual(detail);
    expect(result.index).toEqual(index);
    expect(result.truncated).toBe(false);
  });

  it("enforces maxDetailBlocks by dropping trailing blocks before the prose pass runs", () => {
    const detail = [paragraph({ value: "a" }), paragraph({ value: "b" }), paragraph({ value: "c" })];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "body",
      index: [],
      leadLength: 0,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxDetailBlocks: { cap: "BODY_MAX_BLOCKS", limit: 1 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 5 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    // One surviving block plus the appended warning.
    expect(result.detail.length).toBe(2);
    expect(result.detail[0]).toEqual(paragraph({ value: "a" }));
    expect(result.truncated).toBe(true);
  });

  it("truncates detail and index independently in one call", () => {
    const detail = [paragraph({ value: "x".repeat(50) }), paragraph({ value: "y".repeat(50) })];
    const index = [[text({ value: "a" })], [text({ value: "b" })], [text({ value: "c" })]];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "body",
      index,
      leadLength: 0,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 1 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 60 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.detail.length).toBe(2); // one surviving paragraph + warning
    expect(result.index.length).toBe(1); // "+2 more" warning line only, maxItems - 1 = 0 survivors
    expect(result.truncated).toBe(true);
  });

  it("reports truncated when only the index half drops something, detail untouched", () => {
    const detail = [paragraph({ value: "hello" })];
    const index = [[text({ value: "a" })], [text({ value: "b" })], [text({ value: "c" })]];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "body",
      index,
      leadLength: 0,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 1 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.detail).toEqual(detail);
    expect(result.truncated).toBe(true);
  });
});
