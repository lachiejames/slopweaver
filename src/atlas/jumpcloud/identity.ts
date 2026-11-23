/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing is `kit/identity.ts`. What is this platform's own is the NAMESPACE — `jumpcloud:<kind>` — and
 * it earns its keep here rather than being ceremony: JumpCloud reuses one 24-hex object id shape across
 * every family, and several families genuinely share an id. A system's `_id` is the same string the Apple
 * MDM device row and the aggregated policy-stats row are keyed by, so without the kind in the namespace
 * three different things would collapse into one entity and their details would overwrite each other.
 */
import { stableEntityId } from "../kit/identity.js";

import type { JumpcloudKind } from "./model.js";

/**
 * A stable id for one JumpCloud entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId JumpCloud's own immutable identifier — an `_id` or `id` where the family has one, and
 *   otherwise the bound path the record was read from, which is stable across runs in the same way
 * @returns a 32-character hex digest
 */
export function jumpcloudEntityId({ kind, providerId }: { kind: JumpcloudKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `jumpcloud:${kind}` });
}
