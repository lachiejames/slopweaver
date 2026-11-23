/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * Two of these are PERMANENT and open by construction, and saying so is the point: an atlas should be the
 * thing that reports a gap it cannot close, not the thing that hides one it cannot fix.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { microsoft365GapId } from "./identity.js";
import type { Microsoft365AtlasGap, Microsoft365Channel, Microsoft365Kind } from "./model.js";

/**
 * Every condition a gap here can carry. A closed vocabulary, so closure can match exactly.
 *
 * @internal
 */
export const MICROSOFT365_GAP_CONDITIONS = [
  "spec-unreachable",
  "spec-census-moved",
  "spec-root-undeclared",
  /**
   * Permanent while no Entra application registration exists. It is the single thing standing between this
   * atlas and the directory it is supposed to hold, so it is a first-class row rather than a line in prose.
   */
  "graph-credential-absent",
  /**
   * Permanent by construction: Graph's `beta` surface is larger than `v1.0`, changes without notice, and is
   * what several Entra console pages actually call. Not compiled, and never silently absent.
   */
  "beta-surface-not-compiled",
  "browser-page-unreachable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  /**
   * A reviewed disposition rule that matched nothing in the pinned document. A dead rule reads as considered
   * judgement and is not one, so the sync raises it rather than letting it rot unnoticed.
   */
  "disposition-rule-never-fired",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a gap here can carry.
 *
 * @internal
 */
export type Microsoft365GapCondition = (typeof MICROSOFT365_GAP_CONDITIONS)[number];

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; two for a disagreement, empty when channel-independent
 * @param fields which names the surfaces disagree about, when the condition is a disagreement
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openMicrosoft365Gap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: Microsoft365GapCondition;
  scope: string;
  kind: Microsoft365Kind | null;
  surfaces: readonly Microsoft365Channel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): Microsoft365AtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: microsoft365GapId({ condition, scope }),
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
 *
 * @internal
 */
export type Microsoft365GapRecheck = AtlasGapRecheck;

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
export function reconcileMicrosoft365Gaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly Microsoft365AtlasGap[];
  observed: readonly Microsoft365AtlasGap[];
  rechecks: readonly Microsoft365GapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly Microsoft365AtlasGap[]> {
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
export function openMicrosoft365Gaps({
  gaps,
}: {
  gaps: readonly Microsoft365AtlasGap[];
}): readonly Microsoft365AtlasGap[] {
  return openGaps({ gaps });
}
