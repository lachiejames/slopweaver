/** The visible-width policy one rich block is held to, read off a real Zod refinement at a caller-chosen path. */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkBlockVisibleBounds } from "../../../../outbound/artifact/blockVisibleBounds.js";
import type { CitationWidth, DetailBlock, InlineRun } from "../../../../outbound/artifact/types.js";
import {
  BULLET_ITEM_VISIBLE_MAX,
  PARAGRAPH_VISIBLE_MAX,
  TABLE_CELL_VISIBLE_MAX,
} from "../../../../outbound/assistant/contentLimits.js";

/** One plain text run of `length` characters. */
function text({ length }: { length: number }): InlineRun[] {
  return [{ text: "a".repeat(length), type: "text" }];
}

/** Every issue the check raises for one block rooted at `["section", 4]`, as its path and message. */
function issuesOf({
  block,
  citations,
}: {
  block: DetailBlock;
  citations: readonly CitationWidth[];
}): { path: PropertyKey[]; message: string }[] {
  const parsed = z
    .unknown()
    .superRefine((_value, ctx) => {
      checkBlockVisibleBounds({ block, citations, ctx, path: ["section", 4] });
    })
    .safeParse(null);
  if (parsed.success) {
    return [];
  }
  return parsed.error.issues.map((issue) => ({ message: issue.message, path: issue.path }));
}

describe("checkBlockVisibleBounds", () => {
  it("passes a paragraph at its cap and refuses one past it at the block's own path", () => {
    const atCap: DetailBlock = { runs: text({ length: PARAGRAPH_VISIBLE_MAX }), type: "paragraph" };
    const pastCap: DetailBlock = { runs: text({ length: PARAGRAPH_VISIBLE_MAX + 1 }), type: "paragraph" };
    expect(issuesOf({ block: atCap, citations: [] })).toEqual([]);
    expect(issuesOf({ block: pastCap, citations: [] })).toEqual([
      {
        message: `paragraph is ${String(PARAGRAPH_VISIBLE_MAX + 1)} visible chars, over the ${String(PARAGRAPH_VISIBLE_MAX)} cap`,
        path: ["section", 4],
      },
    ]);
  });

  it("counts a citation chip's label toward the width", () => {
    const runs: InlineRun[] = [...text({ length: PARAGRAPH_VISIBLE_MAX - 2 }), { citationId: "c1", type: "citation" }];
    expect(issuesOf({ block: { runs, type: "paragraph" }, citations: [{ id: "c1", label: "[1]" }] })).toEqual([
      {
        message: `paragraph is ${String(PARAGRAPH_VISIBLE_MAX + 1)} visible chars, over the ${String(PARAGRAPH_VISIBLE_MAX)} cap`,
        path: ["section", 4],
      },
    ]);
  });

  it("names an over-wide bullet as a bullet and a list item as a list item, each at its own index", () => {
    const items = [text({ length: BULLET_ITEM_VISIBLE_MAX }), text({ length: BULLET_ITEM_VISIBLE_MAX + 1 })];
    expect(issuesOf({ block: { items, type: "bullets" }, citations: [] })).toEqual([
      {
        message: `bullet is ${String(BULLET_ITEM_VISIBLE_MAX + 1)} visible chars, over the ${String(BULLET_ITEM_VISIBLE_MAX)} cap`,
        path: ["section", 4, "items", 1],
      },
    ]);
    expect(issuesOf({ block: { items, type: "list" }, citations: [] })).toEqual([
      {
        message: `list item is ${String(BULLET_ITEM_VISIBLE_MAX + 1)} visible chars, over the ${String(BULLET_ITEM_VISIBLE_MAX)} cap`,
        path: ["section", 4, "items", 1],
      },
    ]);
  });

  it("refuses a row narrower than the header before any over-wide cell", () => {
    const block: DetailBlock = {
      columns: ["a", "b"],
      rows: [
        [text({ length: TABLE_CELL_VISIBLE_MAX + 1 })],
        [text({ length: TABLE_CELL_VISIBLE_MAX }), text({ length: TABLE_CELL_VISIBLE_MAX + 1 })],
      ],
      type: "table",
    };
    expect(issuesOf({ block, citations: [] })).toEqual([
      { message: "table row 0 has 1 cells but there are 2 columns", path: ["section", 4, "rows", 0] },
      {
        message: `table cell is ${String(TABLE_CELL_VISIBLE_MAX + 1)} visible chars, over the ${String(TABLE_CELL_VISIBLE_MAX)} cap`,
        path: ["section", 4, "rows", 0, 0],
      },
      {
        message: `table cell is ${String(TABLE_CELL_VISIBLE_MAX + 1)} visible chars, over the ${String(TABLE_CELL_VISIBLE_MAX)} cap`,
        path: ["section", 4, "rows", 1, 1],
      },
    ]);
  });

  it("raises nothing for a table whose rows fit the header and whose cells fit the cap", () => {
    const block: DetailBlock = { columns: ["a"], rows: [[text({ length: TABLE_CELL_VISIBLE_MAX })]], type: "table" };
    expect(issuesOf({ block, citations: [] })).toEqual([]);
  });
});
