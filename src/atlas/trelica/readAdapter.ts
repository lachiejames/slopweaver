/**
 * Trelica's projection into the kit's normalized read view, so `slopweaver atlas trelica read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Three channels rather than one, so an entity projects to up to three observations — and a channel that
 * has never looked contributes nothing rather than an observation claiming it looked and found nothing.
 * That judgement is the whole multi-surface design, so it lives ONCE in `kit/read.ts`'s
 * `channelObservations`; what stays here is only what is genuinely this platform's — which store to read,
 * and that its scope is the platform itself, because a tenant label is a private identifier this repository
 * may not carry.
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
import { TRELICA_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  TRELICA_ATLAS_CHANNELS,
  TRELICA_ATLAS_KINDS,
  TRELICA_ATLAS_PLATFORM,
  TRELICA_ATLAS_SCHEMA_VERSION,
  type TrelicaAtlasEntity,
  type TrelicaAtlasKind,
} from "./model.js";
import { readTrelicaAtlas, trelicaAtlasPaths } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function trelicaObservations({ entity }: { entity: TrelicaAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: TRELICA_ATLAS_CHANNELS });
}

/**
 * Read the Trelica atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readTrelicaSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = trelicaAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readTrelicaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: TRELICA_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = TRELICA_ATLAS_KINDS.map((kind: TrelicaAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: TRELICA_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: TRELICA_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: trelicaObservations({ entity }),
              providerId: entity.providerId,
              scope: TRELICA_ATLAS_PLATFORM,
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
    descriptor: TRELICA_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: TRELICA_ATLAS_PLATFORM,
      schemaVersion: TRELICA_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
