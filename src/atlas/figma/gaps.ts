/**
 * The Figma atlas's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a
 * lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * ## Three of these conditions are open BY CONSTRUCTION, and saying so is the point
 *
 * `api-serves-no-root-enumerator` is the sharpest fact about this platform's REST surface: no operation
 * returns the set of teams or organisations a credential can see, so every team-scoped call in the document
 * needs an id that only a browser URL supplies. Nothing this atlas does can close it; only Figma publishing
 * an endpoint can.
 *
 * `provider-declares-tag-wholly-deprecated` fires for `Projects`, whose three operations are all deprecated
 * — a whole declared surface retired in place. `spec-references-undeclared-endpoint` fires for the three
 * OAuth endpoints the document names in its security schemes and gives no path for.
 *
 * An atlas that cannot close a gap should still be the thing that SAYS the gap is there, which is the
 * owner's "honest about where it thinks it's got gaps".
 *
 * `api-credential-absent` is the fourth, and it is the reason this generation carries no entity at all. It
 * is a gap about ACCESS rather than about Figma, and it names the exact remedy, because a kind that is
 * empty for want of a token and a kind that is empty because the organisation holds nothing are the same
 * file with opposite meanings.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { figmaGapId } from "./identity.js";
import type { FigmaAtlasKind } from "./kinds.js";
import type { FigmaAtlasChannel, FigmaAtlasGap } from "./model.js";

/**
 * Every condition a Figma atlas gap can carry. A closed vocabulary, so closure can match exactly.
 * @internal
 */
export const FIGMA_GAP_CONDITIONS = [
  "api-credential-absent",
  "api-scope-missing",
  "api-serves-no-root-enumerator",
  "api-serves-no-operation-for-surface",
  "browser-page-unreachable",
  "browser-page-not-attempted",
  "browser-page-existence-unconfirmed",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
  "provider-declares-tag-wholly-deprecated",
  "spec-references-undeclared-endpoint",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a Figma atlas gap can carry.
 * @internal
 */
export type FigmaGapCondition = (typeof FIGMA_GAP_CONDITIONS)[number];

/**
 * A Figma atlas gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the two surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openFigmaGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: FigmaGapCondition;
  scope: string;
  kind: FigmaAtlasKind | null;
  surfaces: readonly FigmaAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): FigmaAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: figmaGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/**
 * A condition and scope that were genuinely rechecked, and what the recheck found.
 * @internal
 */
export type FigmaGapRecheck = AtlasGapRecheck;

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
export function reconcileFigmaGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly FigmaAtlasGap[];
  observed: readonly FigmaAtlasGap[];
  rechecks: readonly FigmaGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly FigmaAtlasGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 * @internal
 */
export function openFigmaGaps({ gaps }: { gaps: readonly FigmaAtlasGap[] }): readonly FigmaAtlasGap[] {
  return openGaps({ gaps });
}
