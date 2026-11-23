/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing is `kit/identity.ts`. What is genuinely Datadog's is the NAMESPACE — `datadog:<kind>` — so two
 * kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id for a
 * different thing.
 *
 * There is no organisation or site component, and that is deliberate rather than an omission. An id has to
 * survive this installation being re-pointed at another Datadog site, because the identity of
 * `v1-monitors-list-monitors` is the OPERATION and not where it was read; the org and site are carried on
 * the entity's own `scope` field, where a reader can see them without them being baked into a hash nothing
 * can re-derive.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { DatadogKind } from "./model.js";

/**
 * A stable id for one entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the registry's own surface name for an operation, or the provider's id for a record
 * @returns a 32-character hex digest
 */
export function datadogEntityId({ kind, providerId }: { kind: DatadogKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `datadog:${kind}` });
}

/**
 * A stable id for one gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function datadogGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
