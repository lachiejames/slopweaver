/**
 * This atlas's own gap vocabulary, on top of the two `kit/gaps.ts` requires every atlas to be able to raise.
 *
 * A gap is a first-class OUTPUT here rather than an internal note — `docs/atlas-intent/settled-decisions.md`'s "the gap list is a
 * deliverable" property — so each condition is a question somebody could actually answer, and each names
 * what would close it rather than only what is missing.
 */
import { openStoredChannelGap } from "../kit/channelGap.js";

import type { TwilioAtlasGap, TwilioAtlasKind } from "./model.js";

/**
 * The conditions this atlas raises beyond the kit's own two.
 *
 * `console-signed-out` is Twilio's own, and it exists because the access this run was authorised against
 * turned out not to be there: the console redirects to a login wall in the owner's work Chrome, so every
 * declared page is unreachable for a reason no walk can fix by itself.
 *
 * @internal
 */
export const TWILIO_GAP_CONDITIONS = [
  "spec-unreadable",
  "spec-moved",
  "entity-surface-not-configured",
  "console-signed-out",
  "page-unreachable",
  "page-unphotographed",
] as const;

/**
 * One condition this atlas can raise.
 *
 * @internal
 */
export type TwilioGapCondition = (typeof TWILIO_GAP_CONDITIONS)[number];

/**
 * Raise one gap in this atlas's stored shape.
 *
 * A thin narrowing of `kit/channelGap.ts`, which owns the lifecycle, the stable id, the accumulate
 * semantics and the copy into the mutable arrays this atlas's stored schema declares. What is here is only
 * this atlas's own types on the way in and out.
 *
 * @param condition what is missing, from this atlas's vocabulary or the kit's
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which channels this gap concerns; empty when channel-independent
 * @param fields which names disagree; empty unless this is a disagreement
 * @param reason why, in English, ending in what would close it
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openTwilioGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: string;
  scope: string;
  kind: TwilioAtlasKind | null;
  surfaces: readonly TwilioAtlasGap["surfaces"][number][];
  fields: readonly string[];
  reason: string;
  at: string;
}): TwilioAtlasGap {
  return openStoredChannelGap({ at, condition, fields, kind, reason, scope, surfaces });
}
