/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `microsoft365:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing. There is no tenant component: the id must survive a tenant
 * rename, and a tenant name is a private identifier this repository may not carry at all.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { Microsoft365Kind } from "./model.js";

/**
 * A stable id for one entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId `<METHOD> <path shape>` for an operation, the declared route for a page
 * @returns a 32-character hex digest
 */
export function microsoft365EntityId({ kind, providerId }: { kind: Microsoft365Kind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `microsoft365:${kind}` });
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function microsoft365GapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
