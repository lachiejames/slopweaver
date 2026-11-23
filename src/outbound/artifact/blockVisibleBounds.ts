/**
 * The visible-width bounds one rich block is held to, wherever it sits: a paragraph's width, each bullet or list
 * item's width, and a table's row widths and cell widths. An update card's `detail` (`./detailBlockChecks.ts`)
 * and an answer's `body` (`../assistant/answerBodyChecks.ts`) carry the same block shape under the same caps, so
 * the policy lives here once and each caller names only where its blocks sit. The caps themselves live in
 * `../assistant/contentLimits.ts`.
 */
import type { z } from "zod";

import { BULLET_ITEM_VISIBLE_MAX, PARAGRAPH_VISIBLE_MAX, TABLE_CELL_VISIBLE_MAX } from "../assistant/contentLimits.js";
import type { CitationWidth, DetailBlock } from "./types.js";
import { visibleLengthOfRuns } from "./visibleLength.js";

/** A table row must be exactly as wide as the header. */
function checkTableWidths({
  block,
  path,
  ctx,
}: {
  block: Extract<DetailBlock, { type: "table" }>;
  path: readonly (string | number)[];
  ctx: z.RefinementCtx;
}): void {
  block.rows.forEach((row, rowIndex) => {
    if (row.length === block.columns.length) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message: `table row ${rowIndex} has ${row.length} cells but there are ${block.columns.length} columns`,
      path: [...path, "rows", rowIndex],
    });
  });
}

/** Per-cell prose stays short — width includes a citation chip's own rendered `[n]` label. */
function checkTableCells({
  block,
  path,
  citations,
  ctx,
}: {
  block: Extract<DetailBlock, { type: "table" }>;
  path: readonly (string | number)[];
  citations: readonly CitationWidth[];
  ctx: z.RefinementCtx;
}): void {
  block.rows.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      const width = visibleLengthOfRuns({ citations, runs: cell });
      if (width <= TABLE_CELL_VISIBLE_MAX) {
        return;
      }
      ctx.addIssue({
        code: "custom",
        message: `table cell is ${width} visible chars, over the ${TABLE_CELL_VISIBLE_MAX} cap`,
        path: [...path, "rows", rowIndex, cellIndex],
      });
    });
  });
}

/**
 * Every visible-width bound one block breaks, reported on the refinement context under `path`.
 *
 * @param block the block to bound
 * @param citations the form's citations, whose `[n]` chips count toward a run's visible width
 * @param path where the block sits in its form — `["detail", 2]` or `["body", 1]` — which every issue's path starts from
 * @param ctx the refinement context issues are added to
 */
export function checkBlockVisibleBounds({
  block,
  citations,
  path,
  ctx,
}: {
  block: DetailBlock;
  citations: readonly CitationWidth[];
  path: readonly (string | number)[];
  ctx: z.RefinementCtx;
}): void {
  if (block.type === "paragraph") {
    const width = visibleLengthOfRuns({ citations, runs: block.runs });
    if (width > PARAGRAPH_VISIBLE_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `paragraph is ${width} visible chars, over the ${PARAGRAPH_VISIBLE_MAX} cap`,
        path: [...path],
      });
    }
    return;
  }
  if (block.type === "bullets" || block.type === "list") {
    const label = block.type === "bullets" ? "bullet" : "list item";
    block.items.forEach((item, itemIndex) => {
      const width = visibleLengthOfRuns({ citations, runs: item });
      if (width > BULLET_ITEM_VISIBLE_MAX) {
        ctx.addIssue({
          code: "custom",
          message: `${label} is ${width} visible chars, over the ${BULLET_ITEM_VISIBLE_MAX} cap`,
          path: [...path, "items", itemIndex],
        });
      }
    });
    return;
  }
  checkTableWidths({ block, ctx, path });
  checkTableCells({ block, citations, ctx, path });
}
