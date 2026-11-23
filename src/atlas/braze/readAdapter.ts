/**
 * This atlas's projection into the kit's normalized read view, so `slopweaver atlas braze read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Four channels rather than two, so an entity projects to up to four observations — and a channel that has
 * never looked contributes NOTHING rather than an observation claiming it looked and found nothing. That
 * judgement is the whole multi-surface design, so it lives once in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Notion, Vanta and Microsoft 365 adapters. What stays here is only what is
 * genuinely this atlas's: which store to read, and that its scope is the platform itself, because a REST
 * operation has no workspace or app group to sit under until a credential exists.
 *
 * ## The descriptor a reader gets back is this INSTALL's, not the source file's
 *
 * A surface's `status` is a static literal in `descriptor.ts`, which would be `filled` on every install
 * including one where the sync has never run. So the descriptor returned here is projected through
 * `surfaceFill.ts`, which derives the two published surfaces' status from the manifest against an exact
 * invariant.
 *
 * ## A refusal, not an empty snapshot, when nothing has been published
 *
 * `kit/store.ts` answers an unpublished generation with a `null` manifest and empty files, which several
 * sibling adapters project into a snapshot reporting zero entities. This one refuses instead, and the
 * difference is deliberate: "Braze offers no operations" and "nothing has ever been read" are different
 * claims, and on a platform whose surface map is the whole point the first reads as an answer. The message
 * names the one command that fixes it, which needs no credential — so the refusal is a route rather than a
 * dead end.
 */

import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "#lib/result.js";
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
  BRAZE_ATLAS_PLATFORM,
  BRAZE_ATLAS_SCHEMA_VERSION,
  BRAZE_CHANNELS,
  BRAZE_KINDS,
  type BrazeAtlasEntity,
  type BrazeKind,
} from "./model.js";
import { brazeAtlasPaths, readBrazeAtlas } from "./store.js";
import { brazeDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function brazeObservations({ entity }: { entity: BrazeAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: BRAZE_CHANNELS });
}

/**
 * Read this atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readBrazeSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = brazeAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readBrazeAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: BRAZE_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: BRAZE_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas braze sync — it reads Braze's own published reference and official Postman collection, and needs no credential",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = BRAZE_KINDS.map((kind: BrazeKind): AtlasKindView => {
    const file = files[kind];
    // `manifest` is non-null past the refusal above, and its `kinds` names every kind, so neither needs a
    // nullish guard. `lastAttempt` genuinely is nullable — a kind can be published and never attempted since.
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: BRAZE_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: BRAZE_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: brazeObservations({ entity }),
              providerId: entity.providerId,
              scope: BRAZE_ATLAS_PLATFORM,
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
    descriptor: brazeDescriptorFor({ manifest }),
    generation: {
      mismatched,
      missing,
      platform: BRAZE_ATLAS_PLATFORM,
      schemaVersion: BRAZE_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
