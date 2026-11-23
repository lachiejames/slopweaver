/**
 * Vanta's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a lifecycle
 * rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked. What is Vanta's own is the VOCABULARY below: measured across the
 * two atlases that existed before the kit, 25 distinct conditions were in use and exactly two were shared,
 * so a kit-owned union would have fitted neither. The kit owns only the two corroboration conditions that
 * are part of what an atlas IS, and they are included here so this atlas can raise them.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";
import { stableGapId } from "../kit/identity.js";
import type { VantaChannel, VantaGap, VantaKind } from "./model.js";

/** Every condition a Vanta gap can carry. A closed vocabulary, so closure can match exactly. */
export const VANTA_GAP_CONDITIONS = [
  "api-credential-not-configured",
  "api-config-invalid",
  "api-scope-refused",
  "pagination-incomplete",
  "schema-drift",
  "detail-unreadable",
  "content-download-unreadable",
  "browser-content-download-unreadable",
  "browser-surface-unreadable",
  "sso-redirect-host-unallowlisted",
  "stable-identity-unverified",
  "deep-link-unverified",
  "api-browser-disagreement",
  "outside-planned-scope",
  "child-surface-unsupported-for-parent",
  "openapi-drift",
  "openapi-inventory-unreadable",
  "artifact-integrity-failed",
  // Kit-owned: corroboration between surfaces is part of what an atlas is, so every atlas raises these in
  // the same words. Neither has ever fired here, because the browser channel has never been filled.
  ...KIT_GAP_CONDITIONS,
] as const;

export type VantaGapCondition = (typeof VANTA_GAP_CONDITIONS)[number];

/**
 * A Vanta gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param channel the channel this gap is about, or `null` for a channel-independent gap
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openVantaGap({
  condition,
  scope,
  kind,
  channel,
  reason,
  at,
}: {
  condition: VantaGapCondition;
  scope: string;
  kind: VantaKind | null;
  channel: VantaChannel | null;
  reason: string;
  at: string;
}): VantaGap {
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

/** A condition and scope that were genuinely rechecked, and what the recheck found. */
export type VantaGapRecheck = AtlasGapRecheck;

/**
 * Fold this run's Vanta gaps and rechecks into what is already stored.
 *
 * @param stored every Vanta gap already held
 * @param observed Vanta gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated Vanta gap list, or the reason it cannot be merged
 */
export function reconcileVantaGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly VantaGap[];
  observed: readonly VantaGap[];
  rechecks: readonly VantaGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly VantaGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 */
export function openVantaGaps({ gaps }: { gaps: readonly VantaGap[] }): readonly VantaGap[] {
  return openGaps({ gaps });
}
