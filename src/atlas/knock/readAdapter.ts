/**
 * This atlas's projection into the kit's normalized read view, so `slopweaver atlas knock read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Notion, Airtable, Figma, Prisma and Vanta adapters.
 *
 * What is genuinely this platform's is the SCOPE: an entity carries the environment or account it sits
 * under, and the read view surfaces that rather than the platform name. A platform-level row — a method, a
 * dashboard route — has no scope and falls back to the platform.
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
import { KNOCK_ATLAS_DESCRIPTOR } from "./descriptor.js";
import { KNOCK_ATLAS_KINDS, type KnockAtlasKind } from "./kinds.js";
import { KNOCK_ATLAS_CHANNELS, KNOCK_ATLAS_PLATFORM, KNOCK_ATLAS_SCHEMA_VERSION, type KnockEntity } from "./model.js";
import { knockAtlasPaths, readKnockAtlas } from "./store.js";

/**
 * The scope the read view files one entity under: its own environment or account, or — for a platform-level
 * row, a method or a dashboard route, whose `scope` is `null` by design — the platform itself.
 */
function viewScope({ entity }: { entity: KnockEntity }): string {
  if (entity.scope === null) {
    return KNOCK_ATLAS_PLATFORM;
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
export function knockObservations({ entity }: { entity: KnockEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: KNOCK_ATLAS_CHANNELS });
}

/**
 * Read the Knock atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readKnockSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = knockAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readKnockAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: KNOCK_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: KNOCK_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas knock sync — it compiles both of Knock's published OpenAPI documents and" +
          " the dashboard's own route table, and needs no credential and no network; then" +
          " slopweaver atlas knock walk fills the dashboard surface in your own Chrome",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = KNOCK_ATLAS_KINDS.map((kind: KnockAtlasKind): AtlasKindView => {
    const file = files[kind];
    // `manifest` is non-null past the refusal above, and its `kinds` names every kind, so neither needs a
    // nullish guard. `lastAttempt` genuinely is nullable — a kind can be published and never attempted since.
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: KNOCK_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: KNOCK_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: knockObservations({ entity }),
              providerId: entity.providerId,
              scope: viewScope({ entity }),
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
    descriptor: KNOCK_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: KNOCK_ATLAS_PLATFORM,
      schemaVersion: KNOCK_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
