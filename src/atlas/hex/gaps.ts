/**
 * This atlas's own gap vocabulary, on top of the two `kit/gaps.ts` requires every atlas to be able to raise.
 *
 * A gap is a first-class OUTPUT here rather than an internal note — `docs/atlas-intent/settled-decisions.md`'s "the gap list is a
 * deliverable" property — so each condition is a question somebody could actually answer, and each names
 * what would close it rather than only what is missing.
 *
 * `result-data-withheld` is this atlas's own and is a PERMANENT gap by design, which no sibling has. It is
 * the owner's no-customer-data ruling written where a reader of coverage meets it: the atlas is honest that
 * there is a body it can name and will never hold, rather than leaving a reader to infer from an empty
 * field list that Hex returns nothing.
 */
import { openStoredChannelGap } from "../kit/channelGap.js";

import type { HexAtlasGap, HexAtlasKind } from "./model.js";

/**
 * The conditions this atlas raises beyond the kit's own two.
 *
 * @internal
 */
export const HEX_GAP_CONDITIONS = [
  "spec-unreadable",
  "spec-moved",
  "entity-surface-not-configured",
  "queried-tables-unreadable",
  "result-data-withheld",
  "signed-out",
  "session-ended-by-page",
  "page-unreachable",
  "page-unphotographed",
  "probe-undiscriminating",
] as const;

/**
 * One condition this atlas can raise.
 *
 * @internal
 */
export type HexGapCondition = (typeof HEX_GAP_CONDITIONS)[number];

/**
 * Raise one gap in this atlas's stored shape.
 *
 * A thin narrowing of `kit/channelGap.ts`, which owns the lifecycle, the stable id, the accumulate
 * semantics and the copy into the mutable arrays this atlas's stored schema declares.
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
export function openHexGap({
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
  kind: HexAtlasKind | null;
  surfaces: readonly HexAtlasGap["surfaces"][number][];
  fields: readonly string[];
  reason: string;
  at: string;
}): HexAtlasGap {
  return openStoredChannelGap({ at, condition, fields, kind, reason, scope, surfaces });
}
