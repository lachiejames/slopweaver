/**
 * Figma's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `figma:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing. That collision is not hypothetical here: a Figma component
 * key, style key and variable key are all opaque strings drawn from one namespace, and `getFile` returns
 * all three in one response.
 *
 * There is no team or organisation component, and that is deliberate twice over: an id must survive a team
 * rename, and this organisation's Figma team and org ids are private identifiers this repository may not
 * carry at all — they live only in the generation under `$SLOPWEAVER_HOME`.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { FigmaAtlasKind } from "./kinds.js";

/**
 * A stable id for one Figma atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path template>` for a method, the declared route
 *   for a page, Figma's own file key or numeric id for an entity
 * @returns a 32-character hex digest
 */
export function figmaEntityId({ kind, providerId }: { kind: FigmaAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `figma:${kind}` });
}

/**
 * A stable id for one Figma atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function figmaGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
