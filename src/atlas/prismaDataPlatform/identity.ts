/**
 * The Prisma Data Platform atlas's namespacing over the kit's stable-identity hashing.
 *
 * The hashing itself is `kit/identity.ts`. What is genuinely this atlas's is the NAMESPACE —
 * `prisma-data-platform:<kind>` — so two kinds sharing a provider id cannot collide and no other platform's
 * atlas can produce the same id for a different thing.
 *
 * That collision is not hypothetical here, and this platform makes it unusually easy to fall into: its ids
 * are PREFIXED by type (`wksp_`, `proj_`, `con_`, `usr_`, and the document pins each with its own regular
 * expression), so a reader could reasonably assume the prefix already namespaces them. It does not cover
 * every kind — a database, a build and a bucket id carry no declared prefix at all — and it is the
 * provider's convention rather than a guarantee. Hashing the kind in costs nothing and does not depend on
 * Prisma keeping a habit.
 *
 * There is no workspace or project component in an entity id, and that is deliberate twice over: an id must
 * survive a project rename, and this organisation's Prisma workspace, project and database ids are provider
 * identifiers this repository may not carry at all — they live only in the generation under
 * `$SLOPWEAVER_HOME`.
 */
import { stableEntityId, stableGapId } from "../kit/identity.js";

import type { PrismaDataPlatformAtlasKind } from "./kinds.js";

/**
 * A stable id for one Prisma Data Platform atlas entity.
 *
 * @param kind the entity kind, so two kinds sharing a provider id cannot collide
 * @param providerId the provider's own key — `<METHOD> <path template>` for a method, the declared route
 *   for a console route, the path for an authorization endpoint, and Prisma's own id for an entity
 * @returns a 32-character hex digest
 */
export function prismaDataPlatformEntityId({
  kind,
  providerId,
}: {
  kind: PrismaDataPlatformAtlasKind;
  providerId: string;
}): string {
  return stableEntityId({ components: { providerId }, namespace: `prisma-data-platform:${kind}` });
}

/**
 * A stable id for one Prisma Data Platform atlas gap, keyed by what it is about rather than when it was found.
 *
 * @param condition what is missing
 * @param scope where it is missing
 * @returns a 32-character hex digest
 */
export function prismaDataPlatformGapId({ condition, scope }: { condition: string; scope: string }): string {
  return stableGapId({ condition, scope });
}
