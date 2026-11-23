/**
 * The answer arm's SIZE and CITATION refinements — every rule that reads `body`, `index` and `citations` and
 * decides whether what the composer wrote fits, and whether its evidence hangs together.
 *
 * Split out of `./answerForm.ts` along the seam the file already had: that module declares the SHAPE (every
 * `strictForm`, the arm union, the markup conversion and the truncation pass), while these four functions are
 * the bounds checked over an already-shaped answer. Nothing here parses; each takes a `z.RefinementCtx` and
 * reports. They moved when `answerForm.ts` crossed `file-size-ratchet`'s 560-code-line cap, and the cap is
 * the occasion rather than the reason — the seam is that a bound is re-derivable from the form alone.
 *
 * The one thing this module knows that a width cap does not: the citation COUNT is not a constant. It is
 * whatever `./citedAndShown.ts`'s `citationsCeiling` derives from the answer's own items, so this file and
 * the per-item obligation share one walk.
 */
import type { z } from "zod";

import { checkBlockVisibleBounds } from "../artifact/blockVisibleBounds.js";
import { allRunsOf } from "../artifact/runs.js";
import type { Citation, DetailBlock, InlineRun } from "../artifact/types.js";
import { citationsCeiling } from "./citedAndShown.js";
import { CITATIONS_MAX } from "./contentLimits.js";

/**
 * Per-sub-block bounds for one `body` entry: a paragraph's width, each bullet's width, or a table's row
 * width and cell width — `../artifact/blockVisibleBounds.ts`'s policy, the same one an update card's `detail`
 * is held to, rooted at `body.<index>`. Split out so the top-level refinement stays under this repo's
 * complexity cap.
 */
export function checkBodyBlock({
  block,
  citations,
  index,
  ctx,
}: {
  block: DetailBlock;
  citations: readonly Citation[];
  index: number;
  ctx: z.RefinementCtx;
}): void {
  checkBlockVisibleBounds({ block, citations, ctx, path: ["body", index] });
}

/**
 * The citation COUNT, against the budget this answer's own items earn.
 *
 * It lives here rather than as a `.max()` on the field because the bound is not a constant:
 * `./citedAndShown.ts`'s `citationsCeiling` takes the larger of `CITATIONS_MAX` and the answer's own item
 * count, so a sixteen-row ranked answer may ground all sixteen rows. Its own comment carries why, and the
 * refusal below states the ceiling this answer EARNED rather than the constant, because a composer told a
 * number that is not the one it hit will compose to the wrong one next time.
 */
function checkCitationBudget({
  body,
  index,
  citations,
  ctx,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  ctx: z.RefinementCtx;
}): void {
  const ceiling = citationsCeiling({ body, index });
  if (citations.length <= ceiling) {
    return;
  }
  ctx.addIssue({
    code: "custom",
    message:
      `${String(citations.length)} citations, over the ${String(ceiling)} this answer earns — the budget is ` +
      `the larger of ${String(CITATIONS_MAX)} (CITATIONS_MAX) and the answer's own ` +
      "paragraph/bullet/table-row/index-line count, so one more cited ROW buys one more citation. " +
      "Add the rows the citations ground, or drop the citations.",
    path: ["citations"],
  });
}

/**
 * Citation hygiene: ids are unique, every run in `body` OR `index` resolves to a defined citation, and every
 * defined citation is referenced by at least one run in either. The COUNT is {@link checkCitationBudget}.
 *
 * The LAST check is the one an adversarial review added: an unused citation definition would let a reply
 * inflate its apparent evidence — a longer `citations` array reads as more thoroughly grounded — without
 * attaching a single one to anything actually said. `index` was folded into the same walk it applies to
 * `body`, rather than a separate pass, once a rich-form answer could carry per-row citation chips there too.
 * It is also what keeps `citationsCeiling` honest: a citation that exists must be chipped in an item.
 */
export function checkCitations({
  body,
  index,
  citations,
  ctx,
}: {
  body: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly Citation[];
  ctx: z.RefinementCtx;
}): void {
  checkCitationBudget({ body, citations, ctx, index });
  const ids = citations.map((citation) => citation.id);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: "custom", message: "citation ids must be unique", path: ["citations"] });
  }
  const known = new Set(ids);
  const referenced = new Set<string>();
  const reportRun = ({ run, path }: { run: InlineRun; path: readonly (string | number)[] }): void => {
    if (run.type !== "citation") {
      return;
    }
    if (!known.has(run.citationId)) {
      ctx.addIssue({
        code: "custom",
        message: `citation chip references unknown citation "${run.citationId}"`,
        path: [...path],
      });
      return;
    }
    referenced.add(run.citationId);
  };
  allRunsOf({ detail: body }).forEach((run, runIndex) => {
    reportRun({ path: ["body", runIndex], run });
  });
  index.forEach((item, itemIndex) => {
    item.forEach((run) => {
      reportRun({ path: ["index", itemIndex], run });
    });
  });
  citations.forEach((citation, citationIndex) => {
    if (!referenced.has(citation.id)) {
      ctx.addIssue({
        code: "custom",
        message: `citation "${citation.id}" is defined but no run in body or index cites it`,
        path: ["citations", citationIndex],
      });
    }
  });
}
