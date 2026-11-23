/** The per-sub-block caps an update card's `detail` is held to, read off a real Zod refinement. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkDetailBlock } from "../../../../outbound/artifact/detailBlockChecks.js";
import type { DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  BULLET_ITEM_VISIBLE_MAX,
  PARAGRAPH_VISIBLE_MAX,
  TABLE_CELL_VISIBLE_MAX,
} from "../../../../outbound/assistant/contentLimits.js";

/** One plain text run of `length` characters. */
function text({ length }: { length: number }): InlineRun[] {
  return [{ text: "a".repeat(length), type: "text" }];
}

/** Every issue the check raises for one block at index 2, as `path: message`. */
function issuesOf({ block }: { block: DetailBlock }): string[] {
  const parsed = z
    .unknown()
    .superRefine((_value, ctx) => {
      checkDetailBlock({ block, citations: [], ctx, index: 2 });
    })
    .safeParse(null);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("checkDetailBlock", () => {
  it("passes a paragraph at its cap and refuses one past it", () => {
    expect(issuesOf({ block: { runs: text({ length: PARAGRAPH_VISIBLE_MAX }), type: "paragraph" } })).toEqual([]);
    expect(issuesOf({ block: { runs: text({ length: PARAGRAPH_VISIBLE_MAX + 1 }), type: "paragraph" } })).toEqual([
      `detail.2: paragraph is ${String(PARAGRAPH_VISIBLE_MAX + 1)} visible chars, over the ${String(PARAGRAPH_VISIBLE_MAX)} cap`,
    ]);
  });

  it("names a list item by its own label and index", () => {
    const items = [text({ length: 1 }), text({ length: BULLET_ITEM_VISIBLE_MAX + 1 })];
    expect(issuesOf({ block: { items, type: "list" } })).toEqual([
      `detail.2.items.1: list item is ${String(BULLET_ITEM_VISIBLE_MAX + 1)} visible chars, over the ${String(BULLET_ITEM_VISIBLE_MAX)} cap`,
    ]);
  });

  it("refuses a short table row and an over-wide cell", () => {
    const block: DetailBlock = {
      columns: ["a", "b"],
      rows: [[text({ length: 1 })], [text({ length: 1 }), text({ length: TABLE_CELL_VISIBLE_MAX + 1 })]],
      type: "table",
    };
    expect(issuesOf({ block })).toEqual([
      "detail.2.rows.0: table row 0 has 1 cells but there are 2 columns",
      `detail.2.rows.1.1: table cell is ${String(TABLE_CELL_VISIBLE_MAX + 1)} visible chars, over the ${String(TABLE_CELL_VISIBLE_MAX)} cap`,
    ]);
  });
});
