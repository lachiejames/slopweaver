/**
 * The WorkOS atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `workos:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing.
 *
 * There is no environment component, and that is deliberate: a WorkOS API key is scoped to one environment,
 * so an id carrying the environment would change the moment a second key is configured, and every entity in
 * the store would read as new. The environment is a coverage-cell property (`api-key-environment`) rather
 * than part of an identity.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { WorkosAtlasKind } from "./model.js";

/**
 * A stable id for one WorkOS atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path>` for an operation, the declared route for a
 *   page, and WorkOS's own id for a content entity
 * @returns a 32-character hex digest
 */
export function workosEntityId({ kind, providerId }: { kind: WorkosAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `workos:${kind}` });
}

/**
 * A stable id for one WorkOS atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 *
 * @internal
 */
export function workosGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
