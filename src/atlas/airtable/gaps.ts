/**
 * The Airtable atlas's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a
 * lifecycle rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is this atlas's own is the VOCABULARY below.
 *
 * ## Two of these conditions are open BY CONSTRUCTION, and saying so is the point
 *
 * `provider-declares-tag-with-no-operation` fires for Airtable's `workflow` tag — its own noun for
 * automations, declared in the specification with zero operations under it. Nothing this atlas does can
 * close that; only Airtable publishing an endpoint can. An atlas that cannot close a gap should still be
 * the thing that SAYS the gap is there, which is the owner's "honest about where it thinks it's got gaps".
 *
 * `account-not-in-organisation` is the other, and it is the reason a generation read without a member
 * account carries no entity at all. It is a gap about ACCESS rather than about Airtable, and it names the exact remedy, because a kind
 * that is empty for want of an invite and a kind that is empty because the organisation holds nothing are
 * the same file with opposite meanings.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import { airtableGapId } from "./identity.js";
import type { AirtableAtlasKind } from "./kinds.js";
import type { AirtableAtlasChannel, AirtableAtlasGap } from "./model.js";

/**
 * Every condition an Airtable atlas gap can carry. A closed vocabulary, so closure can match exactly.
 * @internal
 */
export const AIRTABLE_GAP_CONDITIONS = [
  "account-not-in-organisation",
  "api-token-absent",
  "api-scope-missing",
  "browser-page-unreachable",
  "browser-page-not-attempted",
  "browser-screenshot-missing",
  "browser-capture-incomplete",
  "provider-declares-tag-with-no-operation",
  "provider-publishes-no-browser-inventory",
  "records-surface-judged-voluminous",
  ...KIT_GAP_CONDITIONS,
] as const;

/**
 * One condition an Airtable atlas gap can carry.
 * @internal
 */
export type AirtableGapCondition = (typeof AIRTABLE_GAP_CONDITIONS)[number];

/**
 * An Airtable atlas gap observed during this run.
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
export function openAirtableGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: AirtableGapCondition;
  scope: string;
  kind: AirtableAtlasKind | null;
  surfaces: readonly AirtableAtlasChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): AirtableAtlasGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: airtableGapId({ condition, scope }),
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
export type AirtableGapRecheck = AtlasGapRecheck;

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
export function reconcileAirtableGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly AirtableAtlasGap[];
  observed: readonly AirtableAtlasGap[];
  rechecks: readonly AirtableGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly AirtableAtlasGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 * @internal
 */
export function openAirtableGaps({ gaps }: { gaps: readonly AirtableAtlasGap[] }): readonly AirtableAtlasGap[] {
  return openGaps({ gaps });
}
