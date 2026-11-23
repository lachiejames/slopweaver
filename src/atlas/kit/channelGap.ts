/**
 * Narrowing the kit's own gap into the shape a two-channel atlas stores.
 *
 * `gaps.ts` owns the lifecycle, the stable id and the accumulate semantics. What every channelled atlas had
 * written for itself is this: take that gap, add the kind, and copy the readonly arrays into the mutable
 * ones its stored Zod schema declares. Neither half is a platform's, and both were written twice.
 *
 * A gap is a first-class OUTPUT rather than an internal note — `docs/atlas-intent/settled-decisions.md`'s "the gap list is a
 * deliverable" property — so what a platform still owns is its own CONDITION vocabulary, and each condition
 * must name what would close it rather than only what is missing.
 */
import { openGap } from "./gaps.js";

/**
 * One gap as a channelled atlas stores it: the kit's fields, plus this atlas's kind and channels.
 * @internal
 */
export interface StoredChannelGap<TKind extends string, TChannel extends string> {
  condition: string;
  fields: string[];
  firstDetectedAt: string;
  id: string;
  kind: TKind | null;
  lastCheckedAt: string | null;
  lastDetectedAt: string;
  reason: string;
  scope: string;
  status: "open" | "closed";
  surfaces: TChannel[];
}

/**
 * Raise one gap in a channelled atlas's stored shape.
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
export function openStoredChannelGap<TKind extends string, TChannel extends string>({
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
  kind: TKind | null;
  surfaces: readonly TChannel[];
  fields: readonly string[];
  reason: string;
  at: string;
}): StoredChannelGap<TKind, TChannel> {
  const gap = openGap({ at, condition, fields, kind, reason, scope, surfaces });
  return {
    condition: gap.condition,
    fields: [...gap.fields],
    firstDetectedAt: gap.firstDetectedAt,
    id: gap.id,
    kind,
    lastCheckedAt: gap.lastCheckedAt,
    lastDetectedAt: gap.lastDetectedAt,
    reason: gap.reason,
    scope: gap.scope,
    status: gap.status,
    surfaces: [...surfaces],
  };
}
