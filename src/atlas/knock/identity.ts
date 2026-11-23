/**
 * The Knock atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `knock:<kind>` — so two kinds sharing a provider key cannot collide and no other platform's atlas can
 * produce the same id for a different thing.
 *
 * That collision is not hypothetical here, and this platform makes it unusually easy to fall into: Knock
 * identifies almost everything by a human-chosen KEY rather than by a minted id, and the keys are scoped
 * per resource type. A workflow, a broadcast, a guide, an audience and a goal may all be keyed
 * `weekly-digest` in one environment, quite legitimately. Hashing the kind in costs nothing and does not
 * depend on Knock keeping a habit.
 *
 * There is no environment component in an entity id, and that is deliberate twice over: an id must survive
 * a resource being promoted from development to production, and this organisation's Knock account slug and
 * environment slugs are provider identifiers this repository may not carry at all — they live only in the
 * generation under `$SLOPWEAVER_HOME`.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { KnockAtlasKind } from "./kinds.js";

/**
 * A stable id for one Knock atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider key cannot collide
 * @param providerId the provider's own key — `<API> <METHOD> <path template>` for a method, the route
 *   pattern for a dashboard route, and Knock's own key or id for an entity
 * @returns a 32-character hex digest
 */
export function knockEntityId({ kind, providerId }: { kind: KnockAtlasKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `knock:${kind}` });
}

/**
 * A stable id for one Knock atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function knockGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
