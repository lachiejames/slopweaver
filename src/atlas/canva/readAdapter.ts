/**
 * Canva's projection into the kit's normalized read view, so `slopweaver atlas canva read` and `… coverage`
 * work through `registry.ts` with no verb of their own.
 *
 * Three channels rather than one, so an entity projects to up to three observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole multi-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations`;
 * what stays here is only what is genuinely this platform's — which store to read, and that its scope is the
 * platform itself, because an account label is a private identifier this repository may not carry.
 *
 * ## Why this refuses rather than answering an empty snapshot
 *
 * A store with no generation answers `storeUnreadable` naming the sync, never an empty atlas. "Canva has no
 * folder operations" and "nobody has run the sync" are different sentences, and on a surface-map atlas the
 * first one is the more dangerous thing to say by accident — a reader would conclude the platform cannot do
 * something it does perfectly well.
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
import { CANVA_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  CANVA_ATLAS_CHANNELS,
  CANVA_ATLAS_KINDS,
  CANVA_ATLAS_PLATFORM,
  CANVA_ATLAS_SCHEMA_VERSION,
  type CanvaAtlasEntity,
  type CanvaAtlasKind,
} from "./model.js";
import { canvaAtlasPaths, readCanvaAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 * @internal
 */
export function canvaObservations({ entity }: { entity: CanvaAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: CANVA_ATLAS_CHANNELS });
}

/**
 * Read the Canva atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readCanvaSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = canvaAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readCanvaAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: CANVA_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: CANVA_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas canva sync, which needs no credential and no network. The compiled registry of 59 published operations and 18 declared OAuth scopes is already committed to this build in src/atlas/canva/generated/surfaces.ts; what does not exist yet is a GENERATION carrying it",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = CANVA_ATLAS_KINDS.map((kind: CanvaAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: CANVA_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: CANVA_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: canvaObservations({ entity }),
              providerId: entity.providerId,
              scope: CANVA_ATLAS_PLATFORM,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
      publishedCount: status.entityCount,
    };
  });
  return ok({
    descriptor: CANVA_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: CANVA_ATLAS_PLATFORM,
      schemaVersion: CANVA_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
