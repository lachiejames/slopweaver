/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE — `braze:<kind>` —
 * so two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id for
 * a different thing. There is no workspace component: the id must survive a workspace rename, and a workspace
 * name is a private identifier this repository may not carry at all.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { BrazeKind } from "./model.js";

/**
 * A stable id for one entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId `<METHOD> <normalised path>` for an operation, the declared route for a page
 * @returns a 32-character hex digest
 */
export function brazeEntityId({ kind, providerId }: { kind: BrazeKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `braze:${kind}` });
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function brazeGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
