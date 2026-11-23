/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `clerk:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing. There is no application or instance component, deliberately:
 * the id must survive the owner's browser being left on a different instance, and a Clerk application id is
 * a private identifier this repository may not carry at all.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { ClerkAtlasKind } from "./model.js";

/**
 * A stable id for one entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId `<METHOD> <api>:<wire path>` for an operation, the event type for a webhook event, the
 *   declared surface name for a page
 * @returns a 32-character hex digest
 */
export function clerkEntityId({ kind, providerId }: { kind: ClerkAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `clerk:${kind}` });
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function clerkGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
