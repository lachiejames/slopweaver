/**
 * The GraphQL Hive atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `graphql-hive:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas
 * can produce the same id for a different thing.
 *
 * There is no organisation component, and that is deliberate twice over: an id must survive an organisation
 * being renamed, and a registry entity's provider id already carries its own slug path, so the hierarchy is
 * inside the key rather than beside it.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { HiveAtlasKind } from "./model.js";

/**
 * A stable id for one GraphQL Hive atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<ParentType>.<field>` for an operation, the type name for a
 *   type, the slug path for a registry node, and the declared route for a page
 * @returns a 32-character hex digest
 */
export function hiveEntityId({ kind, providerId }: { kind: HiveAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `graphql-hive:${kind}` });
}

/**
 * A stable id for one GraphQL Hive atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 *
 * @internal
 */
export function hiveGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
