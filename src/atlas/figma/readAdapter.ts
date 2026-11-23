/**
 * Figma's projection into the kit's normalized read view, so `slopweaver atlas figma read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Notion, Airtable and Vanta adapters.
 *
 * What is genuinely Figma's is the SCOPE: an entity carries the team, project or file it sits under, and
 * the read view surfaces that rather than the platform name. A platform-level row — a method, a page, a
 * team itself — has no scope and falls back to the platform.
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
import { FIGMA_ATLAS_DESCRIPTOR } from "./descriptor.js";
import { FIGMA_ATLAS_KINDS, type FigmaAtlasKind } from "./kinds.js";
import {
  FIGMA_ATLAS_CHANNELS,
  FIGMA_ATLAS_PLATFORM,
  FIGMA_ATLAS_SCHEMA_VERSION,
  type FigmaAtlasEntity,
  type FigmaAtlasManifest,
} from "./model.js";
import { figmaAtlasPaths, readFigmaAtlas } from "./store.js";

/** What the read view says about one kind's synchronisation, every field of it read off the manifest. */
type KindStatusView = Pick<
  AtlasKindView,
  "lastSuccessAt" | "latestAttemptFailed" | "permissionBlocked" | "publishedCount"
>;

/**
 * One kind's status as the manifest records it. A generation that was never published has no manifest, and
 * reads as never synced: no success, no failed attempt, no block, nothing published.
 */
function figmaKindStatusView({
  manifest,
  kind,
}: {
  manifest: FigmaAtlasManifest | null;
  kind: FigmaAtlasKind;
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
function figmaGenerationStamp({ manifest }: { manifest: FigmaAtlasManifest | null }): string | null {
  if (manifest === null) {
    return null;
  }
  return manifest.updatedAt;
}

/** The team, project or file an entity sits under, or the platform for a platform-level row. */
function figmaEntityScope({ entity }: { entity: FigmaAtlasEntity }): string {
  if (entity.scope === null) {
    return FIGMA_ATLAS_PLATFORM;
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
export function figmaObservations({ entity }: { entity: FigmaAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: FIGMA_ATLAS_CHANNELS });
}

/**
 * Read the Figma atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readFigmaSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = figmaAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readFigmaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: FIGMA_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = FIGMA_ATLAS_KINDS.map((kind: FigmaAtlasKind): AtlasKindView => {
    const file = files[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: FIGMA_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: FIGMA_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: figmaObservations({ entity }),
              providerId: entity.providerId,
              scope: figmaEntityScope({ entity }),
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      ...figmaKindStatusView({ kind, manifest }),
    };
  });
  return ok({
    descriptor: FIGMA_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: FIGMA_ATLAS_PLATFORM,
      schemaVersion: FIGMA_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: figmaGenerationStamp({ manifest }),
    },
    kinds,
  });
}
