/**
 * Nx Cloud's projection into the kit's normalized read view, so `slopweaver atlas nx-cloud read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement lives once in `kit/read.ts`; what stays here is only what is genuinely this atlas's — which
 * store to read, and that an entity's scope is the organisation or workspace it was read under rather than
 * the platform, because unlike Slack or Notion this atlas holds entities from more than one scope.
 */

import { absentAsNull, absentAsNumber } from "#lib/absent.js";
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
import { NX_CLOUD_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  NX_CLOUD_ATLAS_CHANNELS,
  NX_CLOUD_ATLAS_KINDS,
  NX_CLOUD_ATLAS_PLATFORM,
  NX_CLOUD_ATLAS_SCHEMA_VERSION,
  type NxCloudAtlasEntity,
  type NxCloudAtlasKind,
} from "./model.js";
import { nxCloudAtlasPaths, readNxCloudAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function nxCloudObservations({ entity }: { entity: NxCloudAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: NX_CLOUD_ATLAS_CHANNELS });
}

/**
 * Read the Nx Cloud atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readNxCloudSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = nxCloudAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readNxCloudAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: NX_CLOUD_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = NX_CLOUD_ATLAS_KINDS.map((kind: NxCloudAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: NX_CLOUD_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: NX_CLOUD_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: nxCloudObservations({ entity }),
              providerId: entity.providerId,
              scope: entity.scope,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: absentAsNull({ value: status?.lastSuccessAt }),
      latestAttemptFailed: status?.lastAttempt?.outcome === "failed",
      permissionBlocked: absentAsNull({ value: status?.permissionBlocked }),
      publishedCount: absentAsNumber({ value: status?.entityCount, whenAbsent: 0 }),
    };
  });
  return ok({
    descriptor: NX_CLOUD_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: NX_CLOUD_ATLAS_PLATFORM,
      schemaVersion: NX_CLOUD_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
