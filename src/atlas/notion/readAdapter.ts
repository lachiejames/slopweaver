/**
 * Notion's projection into the kit's normalized read view, so `slopweaver atlas notion read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack and Vanta adapters; what stays here is only what is genuinely Notion's — which
 * store to read, and that its scope is the platform itself, because a Notion surface has no account or zone
 * to sit under.
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
import { NOTION_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  NOTION_ATLAS_CHANNELS,
  NOTION_ATLAS_KINDS,
  NOTION_ATLAS_PLATFORM,
  NOTION_ATLAS_SCHEMA_VERSION,
  type NotionAtlasEntity,
  type NotionAtlasKind,
} from "./model.js";
import { notionAtlasPaths, readNotionAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function notionObservations({ entity }: { entity: NotionAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: NOTION_ATLAS_CHANNELS });
}

/**
 * Read the Notion atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readNotionSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = notionAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readNotionAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: NOTION_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: NOTION_ATLAS_PLATFORM,
        remedy: "run: slopweaver atlas notion sync — it reads every endpoint the installed client declares",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = NOTION_ATLAS_KINDS.map((kind: NotionAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: NOTION_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: NOTION_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: notionObservations({ entity }),
              providerId: entity.providerId,
              scope: NOTION_ATLAS_PLATFORM,
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
    descriptor: NOTION_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: NOTION_ATLAS_PLATFORM,
      schemaVersion: NOTION_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
