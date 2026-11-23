/**
 * This atlas's projection into the kit's normalized read view, so `slopweaver atlas clerk read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Three channels rather than two, so an entity projects to up to three observations — and a channel that
 * has never looked contributes NOTHING rather than an observation claiming it looked and found nothing.
 * That judgement is the whole multi-surface design, so it lives once in `kit/read.ts`'s
 * `channelObservations` and is shared with the Slack, Notion, Vanta and Microsoft 365 adapters. What stays
 * here is only what is genuinely this atlas's: which store to read, and that its scope is the platform
 * itself, because a Clerk operation has no account or zone to sit under and its instance may not be named.
 *
 * ## The descriptor a reader gets back is this INSTALL's, not the source file's
 *
 * Both fillable surfaces' statuses are derived from the stored rows by `surfaceFill.ts` rather than read
 * from the static literal in `descriptor.ts`. See that module for why the evidence is a channel on a row
 * rather than a manifest timestamp on this particular atlas.
 *
 * ## A refusal, not an empty snapshot, when nothing has been published
 *
 * `kit/store.ts` answers an unpublished generation with a `null` manifest and empty files, which several
 * sibling adapters project into a snapshot reporting zero entities. This one refuses instead, and the
 * difference is deliberate: "zero operations" and "nothing has ever been compiled" are different claims,
 * and on a platform whose whole deliverable is the surface map, the first reads as an answer. The message
 * names the one command that fixes it, which needs no credential — so the refusal is a route rather than a
 * dead end.
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
  CLERK_ATLAS_KINDS,
  CLERK_ATLAS_PLATFORM,
  CLERK_ATLAS_SCHEMA_VERSION,
  CLERK_CHANNELS,
  type ClerkAtlasEntity,
  type ClerkAtlasKind,
} from "./model.js";
import { clerkAtlasPaths, readClerkAtlas } from "./store.js";
import { clerkDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function clerkObservations({ entity }: { entity: ClerkAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: CLERK_CHANNELS });
}

/**
 * Read this atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readClerkSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = clerkAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readClerkAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: CLERK_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: CLERK_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas clerk sync — it compiles the four pinned Clerk documents and needs no credential; then slopweaver atlas clerk walk fills the dashboard surface in your own Chrome",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = CLERK_ATLAS_KINDS.map((kind: ClerkAtlasKind): AtlasKindView => {
    const file = files[kind];
    // `manifest` is non-null past the refusal above, and its `kinds` names every kind, so neither needs a
    // nullish guard. `lastAttempt` genuinely is nullable — a kind can be published and never attempted since.
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: CLERK_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: CLERK_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: clerkObservations({ entity }),
              providerId: entity.providerId,
              scope: CLERK_ATLAS_PLATFORM,
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
    descriptor: clerkDescriptorFor({ files }),
    generation: {
      mismatched,
      missing,
      platform: CLERK_ATLAS_PLATFORM,
      schemaVersion: CLERK_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
