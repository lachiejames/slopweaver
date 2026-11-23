/**
 * Trelica's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `trelica:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing. There is no tenant component: the id must survive a tenant
 * rename, and the tenant label is a private identifier this repository may not carry at all (`tenant.ts`).
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { TrelicaAtlasKind } from "./model.js";

/**
 * A stable id for one Trelica atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path shape>` for a method, the declared route for a
 *   page, the provider's own record id for an application or a role
 * @returns a 32-character hex digest
 */
export function trelicaEntityId({ kind, providerId }: { kind: TrelicaAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `trelica:${kind}` });
}

/**
 * A stable id for one Trelica atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function trelicaGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
