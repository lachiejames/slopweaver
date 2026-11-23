/**
 * Hex's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE — `hex:<kind>` —
 * so two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id
 * for a different thing. There is no workspace component: the id must survive a workspace being renamed,
 * and a workspace id is an installation identifier this repository does not carry in a hash anyone greps.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { HexAtlasKind } from "./model.js";

/**
 * A stable id for one Hex atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — the evidence body's name for an api, `<METHOD> <path>` for a
 *   method, the declared route template for a page, the object id for a project or a resource
 * @returns a 32-character hex digest
 */
export function hexEntityId({ kind, providerId }: { kind: HexAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `hex:${kind}` });
}

/**
 * A stable id for one Hex atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 *
 * @internal
 */
export function hexGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
