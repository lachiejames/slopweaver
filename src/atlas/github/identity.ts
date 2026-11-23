/**
 * This atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing is `kit/identity.ts`. What is this platform's own is the NAMESPACE — `github:<kind>` — so two
 * kinds sharing a provider id cannot collide and no other platform's atlas can produce the same id for a
 * different thing. That is not hypothetical here: GitHub's numeric ids are per-resource-type and small, so
 * a webhook and an app installation genuinely do share the id `12345`, and without the kind in the
 * namespace they would be one entity.
 *
 * ## Why the scope is part of the identity for a configuration kind
 *
 * A settings document has no id of its own — GitHub does not hand back an identifier for "this repository's
 * merge settings", it hands back the settings. So the identity is the SCOPE it describes: `owner/repo` for
 * a repository's settings, the org login for an organisation's. Without it, two repositories' settings
 * would collide on an empty provider id and the second read would overwrite the first, which
 * `mergeKind`'s duplicate refusal would then report as a run producing the same id twice — the right
 * failure, for the wrong reason, and pointing at the merge rather than at the identity.
 */
import { stableEntityId } from "../kit/identity.js";

import type { GithubKind } from "./model.js";

/**
 * A stable id for one GitHub entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param scopeRef which organisation, repository or environment the entity belongs to — part of the
 *   identity rather than a field, because most configuration kinds have no provider id of their own
 * @param providerId GitHub's own immutable identifier where one exists; for a singleton settings document
 *   this is the scope itself, and for an operation it is the canonical `METHOD /path` route
 * @returns a 32-character hex digest
 */
export function githubEntityId({
  kind,
  scopeRef,
  providerId,
}: {
  kind: GithubKind;
  scopeRef: string;
  providerId: string;
}): string {
  return stableEntityId({ components: { providerId, scopeRef }, namespace: `github:${kind}` });
}
