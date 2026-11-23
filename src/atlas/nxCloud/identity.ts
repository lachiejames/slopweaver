/**
 * Stable identity for every entity and gap this atlas holds.
 *
 * The hashing itself is `kit/identity.ts`'s. What is here is the one decision the kit cannot make: which
 * tuple identifies each kind, and therefore what "the same thing, seen again" means when a later sync
 * merges onto this one. Every tuple below is built from the provider's own immutable ids or from a path
 * PATTERN — never from a name somebody can rename, which is the property that makes accumulate-never-replace
 * work at all.
 */
import { stableEntityId } from "../kit/identity.js";

import { NX_CLOUD_ATLAS_PLATFORM, type NxCloudAtlasKind } from "./model.js";

/**
 * The namespace one kind hashes under.
 *
 * @param kind the entity kind
 * @returns the platform-and-kind namespace
 */
function namespaceFor({ kind }: { kind: NxCloudAtlasKind }): string {
  return `${NX_CLOUD_ATLAS_PLATFORM}:${kind}`;
}

/**
 * The id of one organisation.
 *
 * @param organizationId the provider's own id
 * @returns the stable entity id
 */
export function organizationEntityId({ organizationId }: { organizationId: string }): string {
  return stableEntityId({ components: { organizationId }, namespace: namespaceFor({ kind: "organization" }) });
}

/**
 * The id of one workspace.
 *
 * Keyed by the workspace id ALONE rather than by the pair. A workspace's id is globally unique — it is the
 * `nxCloudId` a repository's own `nx.json` carries, with no organisation beside it — so folding the
 * organisation in would mint a second identity for one workspace the day it is moved between organisations,
 * which is the case accumulate-never-replace exists to survive.
 *
 * @param workspaceId the provider's own id
 * @returns the stable entity id
 */
export function workspaceEntityId({ workspaceId }: { workspaceId: string }): string {
  return stableEntityId({ components: { workspaceId }, namespace: namespaceFor({ kind: "workspace" }) });
}

/**
 * The id of one route of the web client.
 *
 * Keyed by the path PATTERN, so the workspace runs page is one route however many workspaces are walked
 * through it. A concrete URL would mint one entity per pipeline execution, which is the voluminous class
 * arriving through the back door.
 *
 * @param pathPattern the route's path pattern
 * @returns the stable entity id
 */
export function routeEntityId({ pathPattern }: { pathPattern: string }): string {
  return stableEntityId({ components: { pathPattern }, namespace: namespaceFor({ kind: "route" }) });
}

/**
 * The id of one HTTP operation.
 *
 * @param method the HTTP method, uppercased by the caller
 * @param pathPattern the path with its ids replaced by placeholders
 * @returns the stable entity id
 */
export function endpointEntityId({ method, pathPattern }: { method: string; pathPattern: string }): string {
  return stableEntityId({ components: { method, pathPattern }, namespace: namespaceFor({ kind: "endpoint" }) });
}

/**
 * The id of one voluminous family, within one workspace.
 *
 * Scoped to the workspace because the MEASUREMENT is: how many pipeline executions one workspace ran in a
 * window is a different fact from how many another did, and a family entity carries that number.
 *
 * @param family the family's own name
 * @param workspaceId the workspace it was measured in
 * @returns the stable entity id
 */
export function familyEntityId({ family, workspaceId }: { family: string; workspaceId: string }): string {
  return stableEntityId({ components: { family, workspaceId }, namespace: namespaceFor({ kind: "family" }) });
}
