/**
 * Hex's projection into the kit's normalized read view, so `slopweaver atlas hex read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Vanta, Notion and GitHub adapters; what stays here is only what is
 * genuinely Hex's — which store to read, and that its scope is the platform itself, because a Hex surface
 * has no workspace to sit under until a token exists and a workspace id is an installation identifier this
 * repository does not carry.
 *
 * The descriptor a caller gets back is not the module constant: `surfaceFill.ts` derives the definition and
 * console surfaces' status from the manifest, so a fresh install that has never synced reads
 * `declared-unfilled` rather than a literal somebody could edit.
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
import {
  HEX_ATLAS_CHANNELS,
  HEX_ATLAS_KINDS,
  HEX_ATLAS_PLATFORM,
  HEX_ATLAS_SCHEMA_VERSION,
  type HexAtlasEntity,
  type HexAtlasKind,
} from "./model.js";
import { hexAtlasPaths, readHexAtlas } from "./store.js";
import { hexDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function hexObservations({ entity }: { entity: HexAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: HEX_ATLAS_CHANNELS });
}

/**
 * Read the Hex atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readHexSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = hexAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readHexAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: HEX_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = HEX_ATLAS_KINDS.map((kind: HexAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: HEX_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: HEX_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: hexObservations({ entity }),
              providerId: entity.providerId,
              scope: HEX_ATLAS_PLATFORM,
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
    descriptor: hexDescriptorFor({ manifest }),
    generation: {
      mismatched,
      missing,
      platform: HEX_ATLAS_PLATFORM,
      schemaVersion: HEX_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
