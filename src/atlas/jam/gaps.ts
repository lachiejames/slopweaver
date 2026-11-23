/**
 * The Jam atlas's gap lifecycle: the questions this atlas could not answer, held as a lifecycle rather than
 * a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. The VOCABULARY is this atlas's own and lives in `model.ts` beside
 * the schema that admits it, because the stored gap schema is built FROM it — a vocabulary declared here and
 * a schema built there could disagree, and a stored document is the wrong place to find that out.
 *
 * A gap is a first-class OUTPUT here rather than an internal note — `docs/atlas-intent/settled-decisions.md`'s "the gap list is a
 * deliverable" property — so each condition is a question somebody could actually answer, and each names
 * what would close it rather than only what is missing. Four of them are permanently open BY CONSTRUCTION
 * and say so in their own reason: the published API declaring no product operation, the two denominators
 * this repository rather than Jam chose, and the disclosure scoping on a jam's payload.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, openGaps, openTypedGap, reconcileGaps } from "../kit/gaps.js";

import type { JamAtlasChannel, JamAtlasGap, JamAtlasKind, JamGapCondition } from "./model.js";

/**
 * A Jam atlas gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English, ending in what would close it
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openJamGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: JamGapCondition;
  scope: string;
  kind: JamAtlasKind | null;
  surfaces: readonly JamAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): JamAtlasGap {
  return openTypedGap({ at, condition, fields, kind, reason, scope, surfaces });
}

/** A condition and scope that were genuinely rechecked, and what the recheck found. */
export type JamGapRecheck = AtlasGapRecheck;

/**
 * Fold this run's gaps and rechecks into what is already stored.
 *
 * @param stored every gap already held
 * @param observed gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated gap list, or the reason it cannot be merged
 */
export function reconcileJamGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly JamAtlasGap[];
  observed: readonly JamAtlasGap[];
  rechecks: readonly JamGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly JamAtlasGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 *
 * @internal
 */
export function openJamGaps({ gaps }: { gaps: readonly JamAtlasGap[] }): readonly JamAtlasGap[] {
  return openGaps({ gaps });
}
