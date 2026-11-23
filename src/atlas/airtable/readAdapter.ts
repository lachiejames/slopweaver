/**
 * Airtable's projection into the kit's normalized read view, so `slopweaver atlas airtable read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Notion and Vanta adapters.
 *
 * What is genuinely Airtable's is the SCOPE: an entity carries the base, workspace or enterprise account it
 * sits under, and the read view surfaces that rather than the platform name. It is the filter a reader
 * actually wants here — "which base is this field in" is the question a surface map cannot answer and an
 * entity index must. A platform-level row (a method, a page) has no scope and falls back to the platform.
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
import { AIRTABLE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import { AIRTABLE_ATLAS_KINDS, type AirtableAtlasKind } from "./kinds.js";
import {
  AIRTABLE_ATLAS_CHANNELS,
  AIRTABLE_ATLAS_PLATFORM,
  AIRTABLE_ATLAS_SCHEMA_VERSION,
  type AirtableAtlasEntity,
  type AirtableAtlasManifest,
} from "./model.js";
import { airtableAtlasPaths, readAirtableAtlas } from "./store.js";

/** What the read view says about one kind's synchronisation, every field of it read off the manifest. */
type KindStatusView = Pick<
  AtlasKindView,
  "lastSuccessAt" | "latestAttemptFailed" | "permissionBlocked" | "publishedCount"
>;

/**
 * One kind's status as the manifest records it. A generation that was never published has no manifest, and
 * reads as never synced: no success, no failed attempt, no block, nothing published.
 */
function airtableKindStatusView({
  manifest,
  kind,
}: {
  manifest: AirtableAtlasManifest | null;
  kind: AirtableAtlasKind;
}): KindStatusView {
  if (manifest === null) {
    return { lastSuccessAt: null, latestAttemptFailed: false, permissionBlocked: null, publishedCount: 0 };
  }
  const status = manifest.kinds[kind];
  return {
    lastSuccessAt: status.lastSuccessAt,
    latestAttemptFailed: status.lastAttempt?.outcome === "failed",
    permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
    publishedCount: status.entityCount,
  };
}

/** When the published generation was stamped; one that was never published carries no stamp. */
function airtableGenerationStamp({ manifest }: { manifest: AirtableAtlasManifest | null }): string | null {
  if (manifest === null) {
    return null;
  }
  return manifest.updatedAt;
}

/** The base, workspace or enterprise account an entity sits under, or the platform for a platform-level row. */
function airtableEntityScope({ entity }: { entity: AirtableAtlasEntity }): string {
  if (entity.scope === null) {
    return AIRTABLE_ATLAS_PLATFORM;
  }
  return entity.scope;
}

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 * @internal
 */
export function airtableObservations({ entity }: { entity: AirtableAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: AIRTABLE_ATLAS_CHANNELS });
}

/**
 * Read the Airtable atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readAirtableSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = airtableAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readAirtableAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: AIRTABLE_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = AIRTABLE_ATLAS_KINDS.map((kind: AirtableAtlasKind): AtlasKindView => {
    const file = files[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: AIRTABLE_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: AIRTABLE_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: airtableObservations({ entity }),
              providerId: entity.providerId,
              scope: airtableEntityScope({ entity }),
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      ...airtableKindStatusView({ kind, manifest }),
    };
  });
  return ok({
    descriptor: AIRTABLE_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: AIRTABLE_ATLAS_PLATFORM,
      schemaVersion: AIRTABLE_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: airtableGenerationStamp({ manifest }),
    },
    kinds,
  });
}
