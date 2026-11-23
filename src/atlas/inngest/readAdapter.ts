/**
 * This atlas's projection into the kit's normalized read view, so `slopweaver atlas inngest read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Three channels rather than two, so an entity projects to up to three observations — and a channel that has
 * never looked contributes NOTHING rather than an observation claiming it looked and found nothing. That
 * judgement is the whole multi-surface design, so it lives once in `kit/read.ts`'s `channelObservations` and
 * is shared with every sibling adapter. What stays here is only what is genuinely this atlas's: which store
 * to read, and that its scope is the platform itself, because a published operation has no environment or
 * app to sit under.
 *
 * ## The descriptor a reader gets back is this INSTALL's, not the source file's
 *
 * A surface's `status` is a static literal in `descriptor.ts`, which would be `filled` on every install
 * including one where neither verb has run. So the descriptor returned here is projected through
 * `surfaceFill.ts`, which derives all three fillable surfaces from what this generation actually records —
 * the manifest for the compiled one, and each browser surface's own walk-written coverage cell for the other
 * two, since `page` has two writers and a manifest row cannot tell them apart.
 *
 * ## A refusal, not an empty snapshot, when nothing has been published
 *
 * `kit/store.ts` answers an unpublished generation with a `null` manifest and empty files, which a naive
 * adapter projects into a snapshot reporting zero entities. This one refuses instead, and the difference is
 * deliberate: "zero operations" and "nothing has ever been compiled" are different claims, and on a platform
 * whose whole point is that nothing else here holds its apps, the first reads as an answer.
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
  INNGEST_ATLAS_PLATFORM,
  INNGEST_ATLAS_SCHEMA_VERSION,
  INNGEST_CHANNELS,
  INNGEST_KINDS,
  type InngestAtlasEntity,
  type InngestKind,
} from "./model.js";
import { inngestAtlasPaths, readInngestAtlas } from "./store.js";
import { inngestDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function inngestObservations({ entity }: { entity: InngestAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: INNGEST_CHANNELS });
}

/**
 * Read this atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readInngestSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = inngestAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readInngestAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: INNGEST_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: INNGEST_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas inngest sync — it compiles Inngest's own published REST catalogue and the " +
          "dashboard's own route table, and needs no credential",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = INNGEST_KINDS.map((kind: InngestKind): AtlasKindView => {
    const file = files[kind];
    // `manifest` is non-null past the refusal above, and its `kinds` names every kind, so neither needs a
    // nullish guard. `lastAttempt` genuinely is nullable — a kind can be published and never attempted since.
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: INNGEST_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: INNGEST_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: inngestObservations({ entity }),
              providerId: entity.providerId,
              scope: INNGEST_ATLAS_PLATFORM,
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
    descriptor: inngestDescriptorFor({ files, manifest }),
    generation: {
      mismatched,
      missing,
      platform: INNGEST_ATLAS_PLATFORM,
      schemaVersion: INNGEST_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
