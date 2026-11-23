/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing is `kit/identity.ts`. What is this platform's own is the NAMESPACE — `crowdstrike:<kind>`, so
 * two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id for
 * a different thing. That is not hypothetical here: a Zero Trust assessment and a host are BOTH keyed by
 * the same 32-hex agent id, and without the kind in the namespace they would be one entity.
 */
import { stableEntityId } from "../kit/identity.js";

import type { CrowdstrikeKind } from "./model.js";

/**
 * A stable id for one CrowdStrike entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId Falcon's own immutable identifier — an agent id, a policy id, a composite alert id, or
 *   for the console kinds the canonical href or path shape, which are stable properties of the console
 *   rather than of a run
 * @returns a 32-character hex digest
 */
export function crowdstrikeEntityId({ kind, providerId }: { kind: CrowdstrikeKind; providerId: string }): string {
  return stableEntityId({ components: { providerId }, namespace: `crowdstrike:${kind}` });
}
