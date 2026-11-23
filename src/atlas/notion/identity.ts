/**
 * Notion's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE — `notion:<kind>`
 * — so two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id
 * for a different thing. There is no workspace component: the id must survive a workspace rename, and the
 * workspace slug is a private identifier this repository may not carry at all (`browserPages.ts`).
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { NotionAtlasKind } from "./model.js";

/**
 * A stable id for one Notion atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path shape>` for a method, the declared route for a page
 * @returns a 32-character hex digest
 */
export function notionEntityId({ kind, providerId }: { kind: NotionAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `notion:${kind}` });
}

/**
 * A stable id for one Notion atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function notionGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
