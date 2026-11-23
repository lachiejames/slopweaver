/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing is `kit/identity.ts`. What is this platform's own is the NAMESPACE — `onepassword:<kind>`, so
 * two kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id for
 * a different thing.
 *
 * Two of this atlas's kinds are EDGES rather than things, and they have no provider id of their own: a
 * group membership is a `(group, user)` pair and a vault grant is a `(vault, principal)` pair. Both get a
 * composite provider id built here, so the same edge observed on two runs merges rather than duplicating.
 */
import { stableEntityId } from "../kit/identity.js";

import type { OnepasswordKind } from "./model.js";

/**
 * A stable id for one 1Password entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param components 1Password's own immutable identifying fields — never a mutable name an admin can change
 * @returns a 32-character hex digest
 */
export function onepasswordEntityId({
  kind,
  components,
}: {
  kind: OnepasswordKind;
  components: Readonly<Record<string, string | null>>;
}): string {
  return stableEntityId({ components, namespace: `onepassword:${kind}` });
}

/**
 * The composite provider id for a membership or access edge, which 1Password itself does not number.
 *
 * Written as `<parent>:<principal>` rather than hashed, because an edge's provider id is the one field a
 * human greps the atlas by — "which grants mention this vault" has to be answerable with `grep`, and the
 * owner's own requirement for atlas storage is that it stays greppable.
 *
 * @param parentId the vault or group the edge belongs to
 * @param principalId the user or group on the other end
 * @returns the composite id
 */
export function onepasswordEdgeProviderId({
  parentId,
  principalId,
}: {
  parentId: string;
  principalId: string;
}): string {
  return `${parentId}:${principalId}`;
}
