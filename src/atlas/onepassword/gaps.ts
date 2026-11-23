/**
 * This atlas's gap vocabulary and lifecycle: the questions it could not answer, held as a lifecycle rather
 * than a report.
 *
 * The LIFECYCLE is the kit's — accumulate, and close only when a gap's own `(condition, scope)` pair is
 * rechecked. What is this platform's own is the VOCABULARY below. Two of its members exist nowhere else and
 * are the sensitivity design showing through: `sensitivity-gate-reported` records a private-denylist hit the
 * gate reported without refusing, and `item-count-unavailable` records a vault whose count the credential
 * could not see — which is the one thing about this atlas that has to be measured rather than assumed.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";
import { stableGapId } from "../kit/identity.js";
import { ONEPASSWORD_SIGNIN_STEP } from "./credentials.js";
import type { OnepasswordChannel, OnepasswordGap, OnepasswordKind } from "./model.js";

/** Every condition a gap here can carry. A closed vocabulary, so closure can match exactly. */
export const ONEPASSWORD_GAP_CONDITIONS = [
  "cli-not-installed",
  "cli-not-signed-in",
  "cli-permission-refused",
  "cli-output-unreadable",
  "events-token-not-configured",
  "events-scope-refused",
  "events-pagination-incomplete",
  "schema-drift",
  "detail-unreadable",
  "item-count-unavailable",
  "sensitivity-gate-reported",
  "stable-identity-unverified",
  "deep-link-unverified",
  "outside-planned-scope",
  // Kit-owned: corroboration between surfaces is part of what an atlas is, so every atlas raises these in
  // the same words.
  ...KIT_GAP_CONDITIONS,
] as const;

export type OnepasswordGapCondition = (typeof ONEPASSWORD_GAP_CONDITIONS)[number];

/**
 * A gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param channel the channel this gap is about, or `null` for a channel-independent gap
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openOnepasswordGap({
  condition,
  scope,
  kind,
  channel,
  reason,
  at,
}: {
  condition: OnepasswordGapCondition;
  scope: string;
  kind: OnepasswordKind | null;
  channel: OnepasswordChannel | null;
  reason: string;
  at: string;
}): OnepasswordGap {
  return {
    channel,
    condition,
    firstDetectedAt: at,
    id: stableGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
  };
}

/**
 * A condition and scope that were genuinely rechecked, and what the recheck found.
 *
 * @internal
 */
export type OnepasswordGapRecheck = AtlasGapRecheck;

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
export function reconcileOnepasswordGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly OnepasswordGap[];
  observed: readonly OnepasswordGap[];
  rechecks: readonly OnepasswordGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly OnepasswordGap[]> {
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
export function openOnepasswordGaps({ gaps }: { gaps: readonly OnepasswordGap[] }): readonly OnepasswordGap[] {
  return openGaps({ gaps });
}

/**
 * What would resolve a failure of this kind, when that is knowable from the condition alone.
 *
 * @param condition the gap condition a failure earned
 * @returns the remedy to print, or `null` when the condition alone does not determine one
 *
 * @internal
 */
export function onepasswordUnblockFor({ condition }: { condition: OnepasswordGapCondition }): string | null {
  const remedies: Partial<Record<OnepasswordGapCondition, string>> = {
    "cli-not-installed": "install the 1Password CLI and make `op` reachable on PATH",
    "cli-not-signed-in": ONEPASSWORD_SIGNIN_STEP,
    "cli-permission-refused":
      "the signed-in account lacks the administrative permission this surface needs - see the atlas README",
    "events-scope-refused": "re-issue the Events API token with the `auditevents` family ticked",
    "events-token-not-configured": "slopweaver secrets set onepassword-events-token",
  };
  const remedy = remedies[condition];
  if (remedy === undefined) {
    return null;
  }
  return remedy;
}
