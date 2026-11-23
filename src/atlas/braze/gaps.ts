/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * Several of these are PERMANENT and open by construction, and saying so is the point: an atlas should be the
 * thing that reports a gap it cannot close, not the thing that hides one it cannot fix.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { brazeGapId } from "./identity.js";
import type { BrazeAtlasGap, BrazeChannel, BrazeKind } from "./model.js";

/**
 * Every condition a gap here can carry. A closed vocabulary, so closure can match exactly.
 *
 * @internal
 */
export const BRAZE_GAP_CONDITIONS = [
  "published-source-unreachable",
  "published-page-unreadable",
  /** Braze edits its reference constantly, so a moved census is RECORDED rather than refused — `specLock.ts`. */
  "published-census-moved",
  "published-family-undeclared",
  /** A published address that does not resolve as written — a defect in the vendor's own document. */
  "published-path-malformed",
  /**
   * An operation Braze's reference describes and its own official collection omits. 55 of them, measured,
   * including every operation of the `data_objects` and `translations` families.
   */
  "collection-missing-documented-operation",
  /**
   * An operation Braze's own collection ships with no reference page at all. Four of them, measured.
   * Only Braze can close either of these two.
   */
  "documentation-missing-collection-operation",
  /**
   * Permanent while no workspace API key exists. It is one of the two things standing between this atlas and
   * the workspace it is supposed to hold, so it is a first-class row rather than a line in prose.
   */
  "rest-credential-absent",
  /** Permanent while no Braze account exists: no dashboard page has ever been reached. */
  "browser-account-absent",
  "browser-route-not-attempted",
  /**
   * Permanent by construction: Braze publishes navigation breadcrumbs rather than dashboard URLs, so the
   * dashboard's real route inventory cannot be enumerated without a session. The declared list is a FLOOR.
   */
  "browser-route-inventory-undiscovered",
  /**
   * A reviewed disposition rule that matched nothing. A dead rule reads as considered judgement and is not
   * one, so the sync raises it rather than letting it rot unnoticed.
   */
  "disposition-rule-never-fired",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a gap here can carry.
 *
 * @internal
 */
export type BrazeGapCondition = (typeof BRAZE_GAP_CONDITIONS)[number];

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
export function openBrazeGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: BrazeGapCondition;
  scope: string;
  kind: BrazeKind | null;
  surfaces: readonly BrazeChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): BrazeAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: brazeGapId({ condition, scope }),
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
export type BrazeGapRecheck = AtlasGapRecheck;

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
export function reconcileBrazeGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly BrazeAtlasGap[];
  observed: readonly BrazeAtlasGap[];
  rechecks: readonly BrazeGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly BrazeAtlasGap[]> {
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
export function openBrazeGaps({ gaps }: { gaps: readonly BrazeAtlasGap[] }): readonly BrazeAtlasGap[] {
  return openGaps({ gaps });
}
