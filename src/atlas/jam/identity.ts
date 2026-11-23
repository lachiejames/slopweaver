/**
 * Jam's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE — `jam:<kind>` —
 * so two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id
 * for a different thing. There is no workspace component: the id must survive the team being renamed, and a
 * Jam team id is an installation identifier this repository does not carry in a hash anyone greps.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { JamAtlasKind } from "./model.js";

/**
 * A stable id for one Jam atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path>` for an operation, `<METHOD> <host><path>` for
 *   a route, the scope string, the integration slug, the declared route for a page
 * @returns a 32-character hex digest
 */
export function jamEntityId({ kind, providerId }: { kind: JamAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `jam:${kind}` });
}

/**
 * A stable id for one Jam atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 *
 * @internal
 */
export function jamGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
