/**
 * Xero's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE — `xero:<kind>` —
 * so two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id
 * for a different thing. There is no organisation component: the id must survive an organisation rename and
 * must be the same across every tenant this login can switch to, and Xero's own short code is a private
 * identifier this repository may not carry at all (`browserPages.ts`).
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { XeroAtlasKind } from "./model.js";

/**
 * A stable id for one Xero atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path shape>` for a method, the declared surface name
 *   for a page, the family name for a family
 * @returns a 32-character hex digest
 */
export function xeroEntityId({ kind, providerId }: { kind: XeroAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `xero:${kind}` });
}

/**
 * A stable id for one Xero atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function xeroGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
