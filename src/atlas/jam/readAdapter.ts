/**
 * Jam's projection into the kit's normalized read view, so `slopweaver atlas jam read` and `… coverage` work
 * through `registry.ts` with no verb of their own.
 *
 * Three channels rather than two, so an entity projects to up to three observations — and a channel that has
 * never looked contributes NOTHING rather than an observation claiming it looked and found nothing. That
 * judgement is the whole multi-surface design, so it lives once in `kit/read.ts`'s `channelObservations` and
 * is shared with every sibling adapter. What stays here is only what is genuinely Jam's: which store to
 * read, and that its scope is the platform itself, because a Jam surface has no account or zone to sit under
 * and the workspace's own team id is an installation identifier this repository does not carry.
 *
 * ## The descriptor a reader gets back is this INSTALL's, not the source file's
 *
 * A surface's `status` is a static literal in `descriptor.ts`, which would be `filled` on every install
 * including one where neither verb has run. So the descriptor returned here is projected through
 * `surfaceFill.ts`, which derives every fillable surface from the manifest against an exact invariant.
 *
 * ## A refusal, not an empty snapshot, when nothing has been published
 *
 * `kit/store.ts` answers an unpublished generation with a `null` manifest and empty files, which a naive
 * adapter projects into a snapshot reporting zero entities. This one refuses instead, and the difference is
 * deliberate: "zero operations" and "nothing has ever been compiled" are different claims, and on a platform
 * whose whole point is that nothing else here holds its workspace, the first reads as an answer.
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
import {
  JAM_ATLAS_CHANNELS,
  JAM_ATLAS_KINDS,
  JAM_ATLAS_PLATFORM,
  JAM_ATLAS_SCHEMA_VERSION,
  type JamAtlasEntity,
  type JamAtlasKind,
} from "./model.js";
import { jamAtlasPaths, readJamAtlas } from "./store.js";
import { jamDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function jamObservations({ entity }: { entity: JamAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: JAM_ATLAS_CHANNELS });
}

/**
 * Read the Jam atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readJamSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = jamAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readJamAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: JAM_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: JAM_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas jam sync — it publishes the compiled tables and needs no credential and no request",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = JAM_ATLAS_KINDS.map((kind: JamAtlasKind): AtlasKindView => {
    const file = files[kind];
    // `manifest` is non-null past the refusal above, and its `kinds` names every kind, so neither needs a
    // nullish guard. `lastAttempt` genuinely is nullable — a kind can be published and never attempted since.
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: JAM_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: JAM_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: jamObservations({ entity }),
              providerId: entity.providerId,
              scope: JAM_ATLAS_PLATFORM,
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
    descriptor: jamDescriptorFor({ manifest }),
    generation: {
      mismatched,
      missing,
      platform: JAM_ATLAS_PLATFORM,
      schemaVersion: JAM_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
