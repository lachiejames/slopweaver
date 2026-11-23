/**
 * This atlas's projection into the kit's normalized read view, so `slopweaver atlas microsoft365 read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Three channels rather than two, so an entity projects to up to three observations — and a channel that has
 * never looked contributes NOTHING rather than an observation claiming it looked and found nothing. That
 * judgement is the whole multi-surface design, so it lives once in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Notion and Vanta adapters. What stays here is only what is genuinely this
 * atlas's: which store to read, and that its scope is the platform itself, because a Graph operation has no
 * account or zone to sit under.
 *
 * ## The descriptor a reader gets back is this INSTALL's, not the source file's
 *
 * A surface's `status` is a static literal in `descriptor.ts`, which would be `filled` on every install
 * including one where the sync has never run. So the descriptor returned here is projected through
 * `surfaceFill.ts`, which derives the compiled surface's status from the manifest against an exact
 * invariant. See that module for the two atlases where the static form went wrong in production.
 *
 * ## A refusal, not an empty snapshot, when nothing has been published
 *
 * `kit/store.ts` answers an unpublished generation with a `null` manifest and empty files, which every
 * sibling adapter projects into a snapshot reporting zero entities. This one refuses instead, and the
 * difference is deliberate: "zero operations" and "nothing has ever been compiled" are different claims, and
 * on a platform whose whole point is that nothing else holds its directory, the first reads as an answer.
 * `jumpcloud/readAdapter.ts` gives the same reasoning for the same refusal. The message names the one command
 * that fixes it, which needs no credential — so the refusal is a route rather than a dead end.
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
  MICROSOFT365_ATLAS_PLATFORM,
  MICROSOFT365_ATLAS_SCHEMA_VERSION,
  MICROSOFT365_CHANNELS,
  MICROSOFT365_KINDS,
  type Microsoft365AtlasEntity,
  type Microsoft365Kind,
} from "./model.js";
import { microsoft365AtlasPaths, readMicrosoft365Atlas } from "./store.js";
import { microsoft365DescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function microsoft365Observations({
  entity,
}: {
  entity: Microsoft365AtlasEntity;
}): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: MICROSOFT365_CHANNELS });
}

/**
 * Read this atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readMicrosoft365Snapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = microsoft365AtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readMicrosoft365Atlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: MICROSOFT365_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: MICROSOFT365_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas microsoft365 sync — it compiles the pinned Microsoft Graph specification and needs no credential",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = MICROSOFT365_KINDS.map((kind: Microsoft365Kind): AtlasKindView => {
    const file = files[kind];
    // `manifest` is non-null past the refusal above, and its `kinds` names every kind, so neither needs a
    // nullish guard. `lastAttempt` genuinely is nullable — a kind can be published and never attempted since.
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: MICROSOFT365_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: MICROSOFT365_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: microsoft365Observations({ entity }),
              providerId: entity.providerId,
              scope: MICROSOFT365_ATLAS_PLATFORM,
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
    descriptor: microsoft365DescriptorFor({ manifest }),
    generation: {
      mismatched,
      missing,
      platform: MICROSOFT365_ATLAS_PLATFORM,
      schemaVersion: MICROSOFT365_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
