/**
 * `slopweaver atlas prisma-data-platform reset --confirm archive [--json] [--home <dir>]` — archive the
 * current generation and install a fresh, empty one.
 *
 * The whole verb is `atlas/resetRunCore.ts`; what is this atlas's own is where its paths resolve and what an
 * empty generation looks like.
 */
import { resetPrismaDataPlatformAtlas } from "../../../atlas/prismaDataPlatform/reset.js";
import { prismaDataPlatformAtlasPaths } from "../../../atlas/prismaDataPlatform/store.js";
import { runAtlasReset } from "../atlas/resetRunCore.js";

/**
 * Exported so a test can assert this equals the manifest's own copy.
 *
 * @internal
 */
export const PRISMA_DATA_PLATFORM_RESET_USAGE =
  "usage: slopweaver atlas prisma-data-platform reset --confirm archive [--json] [--home <dir>]";

/**
 * Archive this atlas's current generation.
 *
 * @param argv the whole process argv
 * @returns the process exit code
 */
export function prismaDataPlatformAtlasResetCommand(argv: readonly string[]): number {
  return runAtlasReset({
    argv,
    platform: "prisma-data-platform",
    reset: ({ home, at }) => resetPrismaDataPlatformAtlas({ at, paths: prismaDataPlatformAtlasPaths({ home }) }),
    usage: PRISMA_DATA_PLATFORM_RESET_USAGE,
  });
}
