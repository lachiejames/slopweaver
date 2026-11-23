/**
 * Vanta's projection into the kit's normalized read view.
 *
 * Two channels rather than Cloudflare's one, so an entity projects to up to two observations — and a channel
 * that has never looked contributes nothing rather than an observation claiming it looked and found nothing.
 * That judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s
 * {@link channelObservations} and is shared with the Slack adapter rather than written twice; what stays here
 * is only what is genuinely Vanta's — which store to read, and that its scope is the platform itself because
 * a Vanta entity has no account or zone to sit under.
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
import { VANTA_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  VANTA_ATLAS_PLATFORM,
  VANTA_ATLAS_SCHEMA_VERSION,
  VANTA_CHANNELS,
  VANTA_KINDS,
  type VantaEntity,
  type VantaKind,
} from "./model.js";
import { readVantaAtlas, vantaAtlasPaths } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 */
export function vantaObservations({ entity }: { entity: VantaEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: VANTA_CHANNELS });
}

/**
 * Read the Vanta atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readVantaSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = vantaAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readVantaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: VANTA_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = VANTA_KINDS.map((kind: VantaKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: VANTA_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: VANTA_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: vantaObservations({ entity }),
              providerId: entity.providerId,
              scope: VANTA_ATLAS_PLATFORM,
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
    descriptor: VANTA_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: VANTA_ATLAS_PLATFORM,
      schemaVersion: VANTA_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
