/**
 * GraphQL Hive's projection into the kit's normalized read view, so `slopweaver atlas graphql-hive read`
 * and `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations`.
 * What stays here is only what is genuinely this atlas's: which store to read, and that its scope is the
 * platform itself, because an entity's own organisation is already inside its provider id.
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
import { HIVE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  HIVE_ATLAS_CHANNELS,
  HIVE_ATLAS_KINDS,
  HIVE_ATLAS_PLATFORM,
  HIVE_ATLAS_SCHEMA_VERSION,
  type HiveAtlasEntity,
  type HiveAtlasKind,
} from "./model.js";
import { hiveAtlasPaths, readHiveAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function hiveObservations({ entity }: { entity: HiveAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: HIVE_ATLAS_CHANNELS });
}

/**
 * Read the GraphQL Hive atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readGraphqlHiveSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = hiveAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readHiveAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: HIVE_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = HIVE_ATLAS_KINDS.map((kind: HiveAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: HIVE_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: HIVE_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: hiveObservations({ entity }),
              providerId: entity.providerId,
              scope: HIVE_ATLAS_PLATFORM,
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
    descriptor: HIVE_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: HIVE_ATLAS_PLATFORM,
      schemaVersion: HIVE_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
