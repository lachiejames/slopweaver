/**
 * Google Admin's projection into the kit's normalized read view, so `slopweaver atlas google-admin read`
 * and `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Three channels rather than one, so an entity projects to up to three observations — and a channel that
 * has never looked contributes nothing rather than an observation claiming it looked and found nothing.
 * That judgement is the whole multi-surface design, so it lives ONCE in `kit/read.ts`'s
 * `channelObservations`; what stays here is only what is genuinely this platform's — which store to read,
 * and that its scope is the platform itself, because a customer or domain label is a private identifier
 * this repository may not carry.
 *
 * ## Why this refuses rather than answering an empty snapshot
 *
 * A store with no generation answers `storeUnreadable` naming the sync, never an empty atlas. "This
 * Workspace has no admin roles" and "nobody has run the sync" are different sentences, and on a platform
 * whose whole subject is who can administer what, the first one is the more dangerous thing to say by
 * accident.
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
import { GOOGLE_ADMIN_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  GOOGLE_ADMIN_ATLAS_CHANNELS,
  GOOGLE_ADMIN_ATLAS_KINDS,
  GOOGLE_ADMIN_ATLAS_PLATFORM,
  GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION,
  type GoogleAdminAtlasEntity,
  type GoogleAdminAtlasKind,
} from "./model.js";
import { googleAdminAtlasPaths, readGoogleAdminAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 * @internal
 */
export function googleAdminObservations({
  entity,
}: {
  entity: GoogleAdminAtlasEntity;
}): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: GOOGLE_ADMIN_ATLAS_CHANNELS });
}

/**
 * Read the Google Admin atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readGoogleAdminSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = googleAdminAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readGoogleAdminAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: GOOGLE_ADMIN_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: GOOGLE_ADMIN_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas google-admin sync, which needs no credential and no network. The compiled registry of 336 published methods is already committed to this build in src/atlas/googleAdmin/generated/surfaces.ts; what does not exist yet is a GENERATION carrying it",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = GOOGLE_ADMIN_ATLAS_KINDS.map((kind: GoogleAdminAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: GOOGLE_ADMIN_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: GOOGLE_ADMIN_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: googleAdminObservations({ entity }),
              providerId: entity.providerId,
              scope: GOOGLE_ADMIN_ATLAS_PLATFORM,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status.lastSuccessAt,
      latestAttemptFailed: status.lastAttempt?.outcome === "failed",
      permissionBlocked: unsetFieldAsNull({ record: status, key: "permissionBlocked" }),
      publishedCount: status.entityCount,
    };
  });
  return ok({
    descriptor: GOOGLE_ADMIN_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: GOOGLE_ADMIN_ATLAS_PLATFORM,
      schemaVersion: GOOGLE_ADMIN_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
