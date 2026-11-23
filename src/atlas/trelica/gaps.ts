/**
 * The Trelica atlas's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a
 * lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * `api-browser-disagreement` is included because corroboration between surfaces is part of what an atlas
 * IS, and here it is the point rather than an edge case: the published API's vocabulary and the web
 * client's share almost nothing, so it is expected to fire in volume and the report is what a reader
 * actually opens.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { trelicaGapId } from "./identity.js";
import type { TrelicaAtlasChannel, TrelicaAtlasGap, TrelicaAtlasKind } from "./model.js";

/**
 * Every condition a Trelica atlas gap can carry. A closed vocabulary, so closure can match exactly.
 *
 * @internal
 */
export const TRELICA_GAP_CONDITIONS = [
  /** An OpenAPI document the web client names, which the tenant does not serve. */
  "published-document-unreadable",
  /** The published API declares an operation this installation holds no credential to call. */
  "published-api-not-callable",
  /** A first-party call in the closed inventory answered a status that is not success. */
  "first-party-call-refused",
  /** A declared page the walk asked for and did not land on. */
  "browser-page-unreachable",
  /** A page the walk never got to, because the session was lost before its turn. */
  "browser-page-not-attempted",
  /** A page reached and not photographed — an incomplete observation, never a silence. */
  "browser-screenshot-missing",
  /** A page whose own traffic the walk could not fully account for. */
  "browser-capture-incomplete",
  /**
   * A family reached and deliberately not stored row by row. Permanent and open by construction: the
   * disposition is the ruling (`docs/atlas-intent/06-holdings.md`), and an atlas that cannot close a gap should
   * still be the thing that says the gap is there.
   */
  "voluminous-family-not-stored",
  /**
   * The vendor publishes no manifest of its own navigation surface, so the declared page inventory is a
   * list this repository maintains and a page shipped tomorrow is absent from it until someone notices.
   */
  "provider-publishes-no-page-inventory",
  /** AI-spend budgets exist, and no budget record had been seen when the projection was written. */
  "ai-budget-shape-unmeasured",
  /** A cost-explorer row carried no key, no label or an incomplete set of figures, so was left out. */
  "ai-usage-row-unprojected",
  /**
   * An entity read did not yield a complete, admitted list — refused, answered a shape its strict boundary
   * does not read, flagged a page truncated, or held fewer records than the total it stated — so the kind kept
   * what it held rather than publishing a partial list as the whole.
   */
  "first-party-row-unread",
  /** Some runs' step-by-step detail could not be read, so those runs hold their status and no step evidence. */
  "workflow-run-steps-unread",
  ...KIT_GAP_CONDITIONS,
] as const;

/** @internal */
export type TrelicaGapCondition = (typeof TRELICA_GAP_CONDITIONS)[number];

/**
 * A Trelica atlas gap observed during this run.
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
export function openTrelicaGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: TrelicaGapCondition;
  scope: string;
  kind: TrelicaAtlasKind | null;
  surfaces: readonly TrelicaAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): TrelicaAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: trelicaGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}

/** A condition and scope that were genuinely rechecked, and what the recheck found. */
export type TrelicaGapRecheck = AtlasGapRecheck;

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
export function reconcileTrelicaGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly TrelicaAtlasGap[];
  observed: readonly TrelicaAtlasGap[];
  rechecks: readonly TrelicaGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly TrelicaAtlasGap[]> {
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
export function openTrelicaGaps({ gaps }: { gaps: readonly TrelicaAtlasGap[] }): readonly TrelicaAtlasGap[] {
  return openGaps({ gaps });
}
