/**
 * Vanta's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts` — it was byte-identical here and in the Cloudflare atlas. What is
 * genuinely Vanta's is the NAMESPACE: `vanta:<kind>`, so two kinds sharing a provider id cannot collide and
 * no other platform's atlas can produce the same id for a different thing. There is no tenant component,
 * because this atlas only ever points at the one Vanta account the operator has access to.
 */
import { stableEntityId } from "../kit/identity.js";

import type { VantaKind } from "./model.js";

/**
 * A stable id for one Vanta entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param components Vanta's own immutable identifying fields — never a mutable title an admin can rename
 * @returns a 32-character hex digest
 */
export function vantaEntityId({
  kind,
  components,
}: {
  kind: VantaKind;
  components: Readonly<Record<string, string | null>>;
}): string {
  return stableEntityId({ components, namespace: `vanta:${kind}` });
}
