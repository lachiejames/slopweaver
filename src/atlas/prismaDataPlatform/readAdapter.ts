/**
 * This atlas's projection into the kit's normalized read view, so
 * `slopweaver atlas prisma-data-platform read` and `… coverage` work through `registry.ts` with no verb of
 * their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Notion, Airtable, Figma and Vanta adapters.
 *
 * What is genuinely this platform's is the SCOPE: an entity carries the workspace, project or branch it sits
 * under, and the read view surfaces that rather than the platform name. A platform-level row — a method, a
 * console route, an authorization endpoint — has no scope and falls back to the platform.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { stateHomePaths } from "../../stateHome.js";
import {
  type AtlasKindView,
  type AtlasObservationView,
  type AtlasReadError,
  AtlasReadErrors,
  type AtlasReadSnapshot,
  channelObservations,
  coverageCellViews,
  firstChannelDetail,
  gapViews,
} from "../kit/read.js";
import { PRISMA_DATA_PLATFORM_ATLAS_DESCRIPTOR } from "./descriptor.js";
import { PRISMA_DATA_PLATFORM_ATLAS_KINDS, type PrismaDataPlatformAtlasKind } from "./kinds.js";
import {
  PRISMA_DATA_PLATFORM_ATLAS_CHANNELS,
  PRISMA_DATA_PLATFORM_ATLAS_PLATFORM,
  PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION,
  type PrismaDataPlatformEntity,
  type PrismaDataPlatformManifest,
} from "./model.js";
import { prismaDataPlatformAtlasPaths, readPrismaDataPlatformAtlas } from "./store.js";

/** What the read view says about one kind's synchronisation, every field of it read off the manifest. */
type KindStatusView = Pick<
  AtlasKindView,
  "lastSuccessAt" | "latestAttemptFailed" | "permissionBlocked" | "publishedCount"
>;

/**
 * One kind's status as the manifest records it. A generation that was never published has no manifest, and
 * reads as never synced: no success, no failed attempt, no block, nothing published.
 */
function prismaKindStatusView({
  manifest,
  kind,
}: {
  manifest: PrismaDataPlatformManifest | null;
  kind: PrismaDataPlatformAtlasKind;
}): KindStatusView {
  if (manifest === null) {
    return { lastSuccessAt: null, latestAttemptFailed: false, permissionBlocked: null, publishedCount: 0 };
  }
  const status = manifest.kinds[kind];
  return {
    lastSuccessAt: status.lastSuccessAt,
    latestAttemptFailed: status.lastAttempt?.outcome === "failed",
    permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
    publishedCount: status.entityCount,
  };
}

/** When the published generation was stamped; one that was never published carries no stamp. */
function prismaGenerationStamp({ manifest }: { manifest: PrismaDataPlatformManifest | null }): string | null {
  if (manifest === null) {
    return null;
  }
  return manifest.updatedAt;
}

/** The workspace, project or branch an entity sits under, or the platform for a platform-level row. */
function prismaEntityScope({ entity }: { entity: PrismaDataPlatformEntity }): string {
  if (entity.scope === null) {
    return PRISMA_DATA_PLATFORM_ATLAS_PLATFORM;
  }
  return entity.scope;
}

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 * @internal
 */
export function prismaDataPlatformObservations({
  entity,
}: {
  entity: PrismaDataPlatformEntity;
}): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: PRISMA_DATA_PLATFORM_ATLAS_CHANNELS });
}

/**
 * Read the Prisma Data Platform atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readPrismaDataPlatformSnapshot({
  home,
}: {
  home?: string;
} = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = prismaDataPlatformAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readPrismaDataPlatformAtlas({ paths });
  if (snapshot.isErr()) {
    return err(
      AtlasReadErrors.storeUnreadable({ platform: PRISMA_DATA_PLATFORM_ATLAS_PLATFORM, reasons: snapshot.error }),
    );
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = PRISMA_DATA_PLATFORM_ATLAS_KINDS.map(
    (kind: PrismaDataPlatformAtlasKind): AtlasKindView => {
      const file = files[kind];
      return {
        coverage:
          file === null
            ? []
            : coverageCellViews({ cells: file.coverage, surface: PRISMA_DATA_PLATFORM_ATLAS_PLATFORM }),
        entities:
          file === null
            ? []
            : file.entities.map((entity) => ({
                detail: firstChannelDetail({
                  channels: entity.channels,
                  order: PRISMA_DATA_PLATFORM_ATLAS_CHANNELS,
                }),
                id: entity.id,
                kind: entity.kind,
                observations: prismaDataPlatformObservations({ entity }),
                providerId: entity.providerId,
                scope: prismaEntityScope({ entity }),
              })),
        gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
        kind,
        ...prismaKindStatusView({ kind, manifest }),
      };
    },
  );
  return ok({
    descriptor: PRISMA_DATA_PLATFORM_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: PRISMA_DATA_PLATFORM_ATLAS_PLATFORM,
      schemaVersion: PRISMA_DATA_PLATFORM_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: prismaGenerationStamp({ manifest }),
    },
    kinds,
  });
}
