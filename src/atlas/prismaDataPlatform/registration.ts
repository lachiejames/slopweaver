/**
 * The Prisma Data Platform atlas's registration: its descriptor, its store, and the verbs it answers beyond the kit's four.
 *
 * `read` and `coverage` are kit-level and know no platform's vocabulary. These two do: `sync` publishes all
 * three compiled surface maps — the operation registry generated from the platform's own OpenAPI document,
 * the authorization-server endpoint inventory and the console route inventory — and `reset` archives a
 * generation.
 *
 * There is deliberately no `walk` here yet, and its absence is a statement rather than an oversight. A walk
 * needs a console session signed in to `console.prisma.io`, and a signed-out request reaches nothing past the
 * sign-in redirect — `src/atlas/prismaDataPlatform/consoleRoutes.ts` carries the measurement. Shipping a
 * verb that could only photograph the sign-in page would be worse than the declared-unfilled surface that
 * says so.
 */
import type { AtlasPlatformRegistration } from "../kit/registration.js";

/** The prisma-data-platform row of the registry. */
export const PRISMA_DATA_PLATFORM_ATLAS_REGISTRATION: AtlasPlatformRegistration = {
  catalogue: {
    // `sync` reads a committed registry and two committed probe inventories and writes only the local
    // atlas under $SLOPWEAVER_HOME. It makes no network call at all and presents no credential, so this is
    // local-state rather than external-read, and there is no door for it to route through.
    doorRouted: false,
    example: "slopweaver atlas prisma-data-platform read --kind method --query compute",
    summary:
      "The Prisma Data Platform atlas: EVERYTHING REACHABLE, because nothing else here holds a Prisma " +
      "workspace or database. Today that is three surface maps — 115 operations from the OpenAPI " +
      "document the platform serves unauthenticated at api.prisma.io/v1/doc, all 54 declared GETs " +
      "confirmed to exist by probe; 9 authorization-server endpoints, 3 of them confirmed absent; and " +
      "3 console routes — while the 23 entity kinds report not-configured naming the missing " +
      "credential. Its headline gap: 70 of the 115 operations, the whole Prisma Compute product, have " +
      "no documentation page at all",
  },
  platform: "prisma-data-platform",
  readDescriptor: async () => (await import("./descriptor.js")).PRISMA_DATA_PLATFORM_ATLAS_DESCRIPTOR,
  readSnapshot: async (args) => (await import("./readAdapter.js")).readPrismaDataPlatformSnapshot(args),
  verbs: [
    {
      describe:
        "publish all three surface maps from the pinned OpenAPI document and the measured probe\n" +
        "inventories; no network call and no credential",
      load: async () =>
        (await import("../../cli/commands/prismaDataPlatformAtlas/syncRun.js")).prismaDataPlatformAtlasSyncCommand,
      usage: ["sync [--json] [--home <dir>]"],
      verb: "sync",
    },
    {
      describe: "archive the current generation and install a fresh, empty one",
      load: async () =>
        (await import("../../cli/commands/prismaDataPlatformAtlas/resetRun.js")).prismaDataPlatformAtlasResetCommand,
      usage: ["reset --confirm archive [--json] [--home <dir>]"],
      verb: "reset",
    },
  ],
};
