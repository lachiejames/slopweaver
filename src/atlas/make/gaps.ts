/**
 * The one question the Make atlas publishes as open on every fill, until it is answered.
 *
 * `strict-response-boundaries-not-live-calibrated`: the fill validates the fields it KEEPS, but not every
 * key Make sends, because no live answer had been read when it landed (`fill/project.ts` says why). A
 * gap rather than a code comment, because a comment is read by whoever edits the file and a gap is read by
 * whoever reads the atlas — and the person relying on "this organisation has these scenarios" is the latter.
 */
import { openGap } from "../kit/gaps.js";
import { MAKE_FILL_OPERATIONS } from "./fill/plan.js";
import type { MakeAtlasKindFile } from "./model.js";

type Gap = MakeAtlasKindFile["gaps"][number];

/** The condition this atlas raises on its own account. */
export const MAKE_STRICT_BOUNDARY_GAP = "strict-response-boundaries-not-live-calibrated";

/**
 * The strict-boundary gap, open, keeping when it was first raised.
 *
 * @param at this run's ISO timestamp
 * @param earlier the same gap as the store held it, or `null` the first time
 * @returns the gap
 */
export function strictBoundaryGap({ at, earlier }: { at: string; earlier: Gap | null }): Gap {
  const operations = [...new Set(Object.values(MAKE_FILL_OPERATIONS))].toSorted();
  const gap = openGap({
    at,
    condition: MAKE_STRICT_BOUNDARY_GAP,
    fields: [],
    kind: null,
    reason:
      `the fill validates only the fields it keeps from ${operations.join(", ")}; a field Make adds, renames or ` +
      "drops outside them passes unseen. Close it by capturing the first live answers, declaring every key " +
      "each one returns, and moving `fill/project.ts` onto `defineBoundary` strict schemas",
    scope: "make-api-v2",
    surfaces: ["api"],
  });
  return {
    ...gap,
    fields: [],
    firstDetectedAt: earlier === null ? gap.firstDetectedAt : earlier.firstDetectedAt,
    kind: null,
    surfaces: ["api"],
  };
}
