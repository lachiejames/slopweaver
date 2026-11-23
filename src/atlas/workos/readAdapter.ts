/**
 * WorkOS's projection into the kit's normalized read view, so `slopweaver atlas workos read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations`.
 * What stays here is only what is genuinely this atlas's: which store to read, and that its scope is the
 * platform itself, because an entity's own environment is a coverage-cell property rather than part of its
 * identity (`identity.ts` says why).
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
import { WORKOS_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  WORKOS_ATLAS_CHANNELS,
  WORKOS_ATLAS_KINDS,
  WORKOS_ATLAS_PLATFORM,
  WORKOS_ATLAS_SCHEMA_VERSION,
  type WorkosAtlasEntity,
  type WorkosAtlasKind,
} from "./model.js";
import { readWorkosAtlas, workosAtlasPaths } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function workosObservations({ entity }: { entity: WorkosAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: WORKOS_ATLAS_CHANNELS });
}

/**
 * Read the WorkOS atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readWorkosSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = workosAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readWorkosAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: WORKOS_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = WORKOS_ATLAS_KINDS.map((kind: WorkosAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: WORKOS_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: WORKOS_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: workosObservations({ entity }),
              providerId: entity.providerId,
              scope: WORKOS_ATLAS_PLATFORM,
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
    descriptor: WORKOS_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: WORKOS_ATLAS_PLATFORM,
      schemaVersion: WORKOS_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
