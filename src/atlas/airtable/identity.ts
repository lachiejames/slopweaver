/**
 * Airtable's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `airtable:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's atlas can
 * produce the same id for a different thing.
 *
 * There is no enterprise-account or workspace component, and that is deliberate twice over: an id must
 * survive a workspace rename, and the enterprise account id is a private identifier this repository may not
 * carry at all — it lives only in the generation under `$SLOPWEAVER_HOME`.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { AirtableAtlasKind } from "./kinds.js";

/**
 * A stable id for one Airtable atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path template>` for a method, the declared route
 *   for a page, Airtable's own record id for an entity
 * @returns a 32-character hex digest
 */
export function airtableEntityId({ kind, providerId }: { kind: AirtableAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `airtable:${kind}` });
}

/**
 * A stable id for one Airtable atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function airtableGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
