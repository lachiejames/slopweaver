/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * Three of these are PERMANENT and open by construction, and saying so is the point: an atlas should be the
 * thing that reports a gap it cannot close, not the thing that hides one it cannot fix. `clerk-credential-absent`
 * cannot close while this installation holds no key; `clerk-api-versions-not-compiled` cannot close while
 * the pin names one version of each dated API; and `browser-single-instance-only` cannot close at all,
 * because the dashboard shows one instance at a time and the walk drives a browser rather than an account.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { clerkGapId } from "./identity.js";
import type { ClerkAtlasGap, ClerkAtlasKind, ClerkChannel } from "./model.js";

/**
 * Every condition a gap here can carry. A closed vocabulary, so closure can match exactly.
 *
 * @internal
 */
export const CLERK_GAP_CONDITIONS = [
  "spec-unreachable",
  "spec-census-moved",
  /**
   * Permanent while no `clerk-*` entry exists under `$SLOPWEAVER_HOME/secrets`. It is the single thing
   * standing between this atlas and Clerk's own configuration, so it is a first-class row rather than a
   * line in prose.
   */
  "clerk-credential-absent",
  /**
   * Permanent by construction: Clerk keeps six dated versions of its Backend API and six of its Frontend
   * API in the repository at once, and the pin names the newest of each. An installation pinned to an older
   * version reads a surface this atlas does not map.
   */
  "clerk-api-versions-not-compiled",
  /**
   * Permanent by construction: the dashboard renders ONE application and ONE instance at a time, and the
   * walk drives whichever the owner's browser was left on. Every other instance's pages are unmapped.
   */
  "browser-single-instance-only",
  "browser-page-unreachable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  /**
   * An operation the dashboard was seen calling that no pinned document declares. The corroboration output
   * of `docs/atlas-intent/04-corroboration.md`, carried as a gap so it survives in the generation rather than living only
   * in a report — and a LEAD rather than a capability, since seeing the dashboard call something says Clerk
   * holds the data and nothing about what a secret key may ask for.
   */
  "operation-undocumented",
  /**
   * A reviewed disposition rule that matched nothing in the pinned documents. A dead rule reads as
   * considered judgement and is not one, so the sync raises it rather than letting it rot unnoticed.
   */
  "disposition-rule-never-fired",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition a gap here can carry.
 *
 * @internal
 */
export type ClerkGapCondition = (typeof CLERK_GAP_CONDITIONS)[number];

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
export function openClerkGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: ClerkGapCondition;
  scope: string;
  kind: ClerkAtlasKind | null;
  surfaces: readonly ClerkChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): ClerkAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: clerkGapId({ condition, scope }),
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
export type ClerkGapRecheck = AtlasGapRecheck;

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
export function reconcileClerkGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly ClerkAtlasGap[];
  observed: readonly ClerkAtlasGap[];
  rechecks: readonly ClerkGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly ClerkAtlasGap[]> {
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
export function openClerkGaps({ gaps }: { gaps: readonly ClerkAtlasGap[] }): readonly ClerkAtlasGap[] {
  return openGaps({ gaps });
}
