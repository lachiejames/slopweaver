/**
 * Cloudflare's gap vocabulary and lifecycle: the questions this atlas could not answer, held as a lifecycle
 * rather than a report.
 *
 * The LIFECYCLE is the kit's ({@link reconcileGaps}) — accumulate, and close only when a gap's own
 * `(condition, scope)` pair is rechecked, so a run that failed closes nothing at all. `CloudflareGap`'s
 * stored shape carries no `surfaces`/`fields`, having only ever had one surface to name, and it reconciles
 * through the kit unchanged: the kit's lifecycle is generic over the stored shape precisely so a port does
 * not become a disk change. See `kit/gaps.ts`'s header.
 *
 * What is Cloudflare's own is the VOCABULARY below, which maps 1:1 onto `CloudflareClientError`'s own
 * `kind` field (`client.ts`) rather than string-matching a raw error message the way Vanta's has to — the
 * typed boundary this atlas already has makes that classification exact instead of heuristic. The kit owns
 * only the two corroboration conditions that are part of what an atlas IS, and they are included here so
 * this atlas can raise them.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasGapRecheck, KIT_GAP_CONDITIONS, openGaps, reconcileGaps } from "../kit/gaps.js";

import type { CloudflareClientError } from "./errors.js";
import { cloudflareGapId } from "./identity.js";
import type { CloudflareGap, CloudflareKind } from "./model.js";

/** Every condition a Cloudflare gap can carry. A closed vocabulary, so closure can match exactly. The disk
 * schema itself keeps `condition` a free-text string — see `model.ts`'s header — so this closed set is an
 * application-level discipline layered on top of it, not a schema constraint. */
export const CLOUDFLARE_GAP_CONDITIONS = [
  "authentication-refused",
  "permission-refused",
  "not-found",
  "rate-limited",
  "provider-error",
  "transport-error",
  "response-envelope-error",
  "schema-drift",
  /** A parent's embedded child collection came back shorter than the parent's own declared count — the SDK
   * presented a single page with no further cursor, so a mismatch cannot be resolved by paging further. */
  "pagination-incomplete",
  "graphql-error",
  // Kit-owned: corroboration between surfaces is part of what an atlas is, so every atlas raises these in
  // the same words. Neither has ever fired here, because this atlas has only ever had one surface.
  ...KIT_GAP_CONDITIONS,
] as const;

export type CloudflareGapCondition = (typeof CLOUDFLARE_GAP_CONDITIONS)[number];

/**
 * The 1:1 map from a typed client error's kind to this atlas's closed gap vocabulary.
 *
 * @param error the typed client error a failed read produced
 * @returns the matching gap condition
 */
export function classifyCloudflareClientErrorGap({ error }: { error: CloudflareClientError }): CloudflareGapCondition {
  switch (error.kind) {
    case "authentication":
      return "authentication-refused";
    case "permission":
      return "permission-refused";
    case "not-found":
      return "not-found";
    case "rate-limit":
      return "rate-limited";
    case "provider":
      return "provider-error";
    case "transport":
      return "transport-error";
    case "response-envelope":
      return "response-envelope-error";
    case "schema":
      return "schema-drift";
    case "graphql-error":
      return "graphql-error";
  }
}

/**
 * A Cloudflare gap observed during this run.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openCloudflareGap({
  condition,
  scope,
  kind,
  reason,
  at,
}: {
  condition: CloudflareGapCondition;
  scope: string;
  kind: CloudflareKind | null;
  reason: string;
  at: string;
}): CloudflareGap {
  return {
    condition,
    firstDetectedAt: at,
    id: cloudflareGapId({ condition, scope }),
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
 * Kept as its own interface rather than aliased to the kit's {@link AtlasGapRecheck}, whose `condition` is a
 * bare `string`: every caller here builds rechecks by iterating {@link CLOUDFLARE_GAP_CONDITIONS}, and a
 * recheck naming a condition no gap in this atlas can carry would silently close nothing. The narrower type
 * is assignable to the kit's, so the lifecycle takes it unchanged.
 */
export interface CloudflareGapRecheck extends AtlasGapRecheck {
  readonly condition: CloudflareGapCondition;
}

/**
 * A resolved recheck of every Cloudflare gap condition at one scope — what a read that succeeded there earns.
 *
 * @param scope the scope the successful read covered
 * @returns one resolved recheck per condition, all at that scope
 */
export function recheckEveryCondition({ scope }: { scope: string }): readonly CloudflareGapRecheck[] {
  return CLOUDFLARE_GAP_CONDITIONS.map((condition) => ({ condition, resolved: true, scope }));
}

/**
 * Fold this run's Cloudflare gaps and rechecks into what is already stored.
 *
 * @param stored every Cloudflare gap already held
 * @param observed Cloudflare gaps this run detected
 * @param rechecks conditions and scopes this run actually rechecked
 * @param runFailed whether the run itself failed; a failed run may not close anything
 * @param at this run's ISO timestamp
 * @returns the accumulated Cloudflare gap list, or the reason it cannot be merged
 */
export function reconcileCloudflareGaps({
  stored,
  observed,
  rechecks,
  runFailed,
  at,
}: {
  stored: readonly CloudflareGap[];
  observed: readonly CloudflareGap[];
  rechecks: readonly CloudflareGapRecheck[];
  runFailed: boolean;
  at: string;
}): Result<readonly CloudflareGap[]> {
  return reconcileGaps({ at, observed, rechecks, runFailed, stored });
}

/**
 * The open gaps, which is what a reader and a ticket list both want.
 *
 * @param gaps every gap held
 * @returns only the open ones
 */
export function openCloudflareGaps({ gaps }: { gaps: readonly CloudflareGap[] }): readonly CloudflareGap[] {
  return openGaps({ gaps });
}
