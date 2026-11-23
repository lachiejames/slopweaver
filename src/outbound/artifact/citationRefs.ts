/**
 * The update card's dead-chip refusal: every `[n]` citation run in its detail and index must name a citation the
 * card declares. Kept beside `./citationMarkers.ts`, which types the markers and refuses the opposite case — a
 * declared citation no chip points at.
 */
import type { z } from "zod";

import { runSequencesOf } from "./runs.js";
import type { CitationWidth, DetailBlock, InlineRun } from "./types.js";

/**
 * Every `citation` run must point at a citation that exists — a dead `[n]` chip is a defect.
 *
 * Walks the index as well as the detail, and that is not symmetry for its own sake: the renderer's
 * `citationLink` THROWS on an unknown id, so a chip missed here does not degrade, it fails the send at render
 * time with a stack rather than a form error naming the path.
 */
export function checkCitationRefs({
  detail,
  index,
  citations,
  ctx,
}: {
  detail: readonly DetailBlock[];
  index: readonly (readonly InlineRun[])[];
  citations: readonly CitationWidth[];
  ctx: z.RefinementCtx;
}): void {
  const known = new Set(citations.map((c) => c.id));
  const report = ({ run, path }: { run: InlineRun; path: readonly (string | number)[] }): void => {
    if (run.type !== "citation" || known.has(run.citationId)) {
      return;
    }
    ctx.addIssue({
      code: "custom",
      message: `citation chip references unknown citation "${run.citationId}"`,
      path: [...path],
    });
  };
  detail.forEach((block, blockIndex) => {
    runSequencesOf({ block })
      .flat()
      .forEach((run) => {
        report({ path: ["detail", blockIndex], run });
      });
  });
  index.forEach((item, itemIndex) => {
    item.forEach((run) => {
      report({ path: ["index", itemIndex], run });
    });
  });
}
