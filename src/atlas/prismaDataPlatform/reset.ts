/**
 * `atlas prisma-data-platform reset` — archive the whole current atlas, then install a fresh, empty
 * generation.
 *
 * Nothing is ever deleted: the archive-and-restore protocol is `kit/reset.ts`, and what is this atlas's own
 * is only the shape of an EMPTY generation — one file per kind, so the freshly installed generation is
 * complete rather than partial. The archive lands under
 * `$SLOPWEAVER_HOME/atlas/_superseded/prisma-data-platform/`.
 *
 * Screenshots go with it. They live under the same root the archive moves, so the archived generation keeps
 * every artifact its own records reference, and the fresh generation starts with none.
 */
import type { Result } from "../../lib/result.js";
import { type AtlasResetOutcome, resetAtlas } from "../kit/reset.js";

import { emptyPrismaDataPlatformKindFiles, initialPrismaDataPlatformManifest } from "./model.js";
import { PRISMA_DATA_PLATFORM_STORE_SPEC, type PrismaDataPlatformAtlasPaths } from "./store.js";

/**
 * What a reset did.
 * @internal
 */
export type PrismaDataPlatformResetOutcome = AtlasResetOutcome;

/**
 * Archive the current Prisma Data Platform atlas and install a fresh, empty generation in its place.
 *
 * @param paths the resolved atlas paths
 * @param at this run's ISO timestamp, used to both name the archive and stamp the empty generation
 * @returns where the archive landed, or every reason nothing was reset
 */
export function resetPrismaDataPlatformAtlas({
  paths,
  at,
}: {
  paths: PrismaDataPlatformAtlasPaths;
  at: string;
}): Result<PrismaDataPlatformResetOutcome> {
  return resetAtlas({
    at,
    emptyFiles: emptyPrismaDataPlatformKindFiles({ at }),
    emptyManifest: initialPrismaDataPlatformManifest({ updatedAt: at }),
    paths,
    spec: PRISMA_DATA_PLATFORM_STORE_SPEC,
  });
}
