/**
 * The Xero atlas's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a
 * lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below. Two of its
 * conditions are the ones the owner's own definition makes first-class: `entity-ingest-not-configured` is
 * why a family row carries no rows, and `family-unjudged` is the only way a build whose judgement table has
 * fallen behind its SDK can say so.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { xeroGapId } from "./identity.js";
import type { XeroAtlasChannel, XeroAtlasGap, XeroAtlasKind } from "./model.js";

/** Every condition a Xero atlas gap can carry. A closed vocabulary, so closure can match exactly. */
const XERO_GAP_CONDITIONS = [
  "sdk-declarations-unreadable",
  "browser-page-unreachable",
  "browser-page-not-addressable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
  // The one that answers "why can this atlas not tell me what we spent". Every family carries it until an
  // OAuth connection exists, and it closes for a family the moment one does.
  "entity-ingest-not-configured",
  // Cannot occur on a green build — `families.test.ts` fails first — and exists so an install whose SDK ran
  // ahead of the judgement table SAYS so rather than quietly claiming the safer half.
  "family-unjudged",
  // Permanent, and open by construction: Xero publishes no manifest of its own web-client navigation, so
  // the declared inventory is a hand list and a page Xero ships tomorrow is absent from it until someone
  // notices. An atlas that cannot close a gap should still be the thing that says the gap is there.
  "provider-publishes-no-browser-inventory",
  ...KIT_GAP_CONDITIONS,
] as const;

export type XeroGapCondition = (typeof XERO_GAP_CONDITIONS)[number];

/**
 * A Xero atlas gap observed during this run.
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
export function openXeroGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: XeroGapCondition;
  scope: string;
  kind: XeroAtlasKind | null;
  surfaces: readonly XeroAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): XeroAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: xeroGapId({ condition, scope }),
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
export type XeroGapRecheck = AtlasGapRecheck;

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
export function reconcileXeroGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly XeroAtlasGap[];
  observed: readonly XeroAtlasGap[];
  rechecks: readonly XeroGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly XeroAtlasGap[]> {
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
export function openXeroGaps({ gaps }: { gaps: readonly XeroAtlasGap[] }): readonly XeroAtlasGap[] {
  return openGaps({ gaps });
}
