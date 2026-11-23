/*
 * The overages `truncateFormForCaps` reports: each over-cap measurement is named against its own constant and
 * limit, measured as authored, and none is reported when nothing was over. It moved here when `truncate.test.ts`
 * was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { truncateFormForCaps } from "../../../../../outbound/artifact/truncate.js";
import { paragraph, text } from "./harness.js";

describe("overages truncateFormForCaps reports", () => {
  it("names the block count it measured against BODY_MAX_BLOCKS", () => {
    const detail = [paragraph({ value: "a" }), paragraph({ value: "b" }), paragraph({ value: "c" })];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "body",
      index: [],
      leadLength: 0,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxDetailBlocks: { cap: "BODY_MAX_BLOCKS", limit: 2 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 5 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.overages).toEqual([{ cap: "BODY_MAX_BLOCKS", limit: 2, measured: 3, what: "body blocks" }]);
  });

  it("measures prose as AUTHORED, not as it stands after the block pass dropped a paragraph", () => {
    // Four 50-char paragraphs is 200 authored characters. The block pass cuts it to two before the prose
    // pass ever runs, so a post-pass measurement would report 100 and understate the real overage by half.
    const detail = [
      paragraph({ value: "x".repeat(50) }),
      paragraph({ value: "y".repeat(50) }),
      paragraph({ value: "z".repeat(50) }),
      paragraph({ value: "w".repeat(50) }),
    ];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "body",
      index: [],
      leadLength: 0,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxDetailBlocks: { cap: "BODY_MAX_BLOCKS", limit: 2 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 5 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 120 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.overages).toEqual([
      { cap: "BODY_MAX_BLOCKS", limit: 2, measured: 4, what: "body blocks" },
      { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 120, measured: 200, what: "visible characters of body prose" },
    ]);
  });

  it("names the longest table and the longest bullet list, not every block", () => {
    const detail = [
      {
        columns: ["h"],
        rows: [[[text({ value: "a" })]], [[text({ value: "b" })]], [[text({ value: "c" })]]],
        type: "table" as const,
      },
      { items: [[text({ value: "1" })], [text({ value: "2" })]], type: "bullets" as const },
    ];
    const result = truncateFormForCaps({
      citations: [],
      detail,
      field: "detail",
      index: [],
      leadLength: 0,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 1 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 5 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 2 },
    });

    expect(result.overages).toEqual([
      { cap: "TABLE_MAX_ROWS", limit: 2, measured: 3, what: "rows in the longest detail table" },
      { cap: "BULLETS_MAX_ITEMS", limit: 1, measured: 2, what: "items in the longest detail bullet list" },
    ]);
  });

  it("names the index count and the whole above-the-fold region separately", () => {
    const index = [
      [text({ value: "a".repeat(40) })],
      [text({ value: "b".repeat(40) })],
      [text({ value: "c".repeat(40) })],
    ];
    const result = truncateFormForCaps({
      citations: [],
      detail: [paragraph({ value: "hello" })],
      field: "body",
      index,
      leadLength: 10,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 100 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 2 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.overages).toEqual([
      { cap: "INDEX_MAX_ITEMS", limit: 2, measured: 3, what: "index lines" },
      {
        cap: "ABOVE_FOLD_VISIBLE_MAX",
        limit: 100,
        measured: 130,
        what: "visible characters above the fold (lead + index)",
      },
    ]);
  });

  it("reports NO overage when nothing was over cap", () => {
    const result = truncateFormForCaps({
      citations: [],
      detail: [paragraph({ value: "hello" })],
      field: "body",
      index: [],
      leadLength: 5,
      maxAboveFold: { cap: "ABOVE_FOLD_VISIBLE_MAX", limit: 650 },
      maxBulletItems: { cap: "BULLETS_MAX_ITEMS", limit: 8 },
      maxDetailBlocks: { cap: "BODY_MAX_BLOCKS", limit: 12 },
      maxIndexItems: { cap: "INDEX_MAX_ITEMS", limit: 5 },
      maxProse: { cap: "DETAIL_PROSE_VISIBLE_MAX", limit: 1800 },
      maxTableRows: { cap: "TABLE_MAX_ROWS", limit: 10 },
    });

    expect(result.overages).toEqual([]);
  });
});
