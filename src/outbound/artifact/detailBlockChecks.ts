/**
 * The per-sub-block bounds an update card's `detail` is held to: a paragraph's width, each bullet or list item's
 * width, and a table's row widths and cell widths. Split out of `./schema.ts`, which declares the shapes, because
 * these are the measured caps applied to one block at a time — the policy is `./blockVisibleBounds.ts`, shared
 * with an answer's `body`, and the caps themselves live in `../assistant/contentLimits.ts`.
 */
import type { z } from "zod";

import { checkBlockVisibleBounds } from "./blockVisibleBounds.js";
import type { CitationWidth, DetailBlock } from "./types.js";

/**
 * Per-sub-block bounds, reported on the refinement context at `detail.<index>`. Split out so the update card's
 * top-level refinement stays under the complexity cap.
 *
 * @param block the sub-block to bound
 * @param index the block's position in `detail`, which every issue's path starts from
 * @param citations the card's citations, whose `[n]` chips count toward a run's visible width
 * @param ctx the refinement context issues are added to
 */
export function checkDetailBlock({
  block,
  index,
  citations,
  ctx,
}: {
  block: DetailBlock;
  index: number;
  citations: readonly CitationWidth[];
  ctx: z.RefinementCtx;
}): void {
  checkBlockVisibleBounds({ block, citations, ctx, path: ["detail", index] });
}
