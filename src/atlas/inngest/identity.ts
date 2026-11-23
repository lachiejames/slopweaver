/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `inngest:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing. There is no account component: the id must survive an account
 * rename, and an account name is a private identifier this repository may not carry at all.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { InngestKind } from "./model.js";

/**
 * A stable id for one entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId `<version> <operationId>` for a REST operation, the declared route for a page, the
 *   operation name for a GraphQL call, Inngest's own id or slug for an entity
 * @returns a 32-character hex digest
 */
export function inngestEntityId({ kind, providerId }: { kind: InngestKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `inngest:${kind}` });
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function inngestGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
