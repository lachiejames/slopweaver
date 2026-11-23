/**
 * Opening one Aether gap.
 *
 * This atlas builds its gaps directly from what a walk observed (`walkGaps.ts`'s gap table) rather than by
 * classifying a typed provider failure, because its walk fails through the kit's own `BrowserTransportError`
 * and its reduction is pure — there is no per-domain error union to translate. So the only thing genuinely
 * this platform's own is minting a stable, stamped gap from a `(condition, scope)` pair; the accumulate/close
 * LIFECYCLE stays the kit's (`kit/gaps.ts`), because a walk that fully replaces the store closes a shortfall
 * by simply not raising it again.
 */
import { stableGapId } from "../kit/identity.js";

import type { AetherGap } from "./entities.js";
import type { AetherGapCondition, AetherKind, AetherSurface } from "./model.js";

/**
 * A gap observed during this run, open and stamped.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @param kind the entity kind this gap is about, or `null` for a cross-kind gap
 * @param surfaces which surfaces this gap concerns; empty when surface-independent
 * @param fields which fields are affected; empty unless the gap names some
 * @param reason why, in English
 * @param at this run's ISO timestamp
 * @returns the gap, open and stamped
 */
export function openAetherGap({
  condition,
  scope,
  kind,
  surfaces,
  fields,
  reason,
  at,
}: {
  condition: AetherGapCondition;
  scope: string;
  kind: AetherKind | null;
  surfaces: readonly AetherSurface[];
  fields: readonly string[];
  reason: string;
  at: string;
}): AetherGap {
  return {
    condition,
    fields: [...fields],
    firstDetectedAt: at,
    id: stableGapId({ condition, scope }),
    kind,
    lastCheckedAt: at,
    lastDetectedAt: at,
    reason,
    scope,
    status: "open",
    surfaces: [...surfaces],
  };
}
