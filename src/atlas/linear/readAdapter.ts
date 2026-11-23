/**
 * Linear's projection into the kit's normalized read view.
 *
 * The channel projection itself is `kit/read.ts`'s {@link channelObservations}, shared with Slack and Vanta.
 * What is genuinely Linear's is which store to read, its platform discriminator, and the SCOPE it stamps on
 * each entity: this atlas is the first whose entities are not all workspace-wide, so a `setting` carries the
 * team it configures and everything else carries the workspace.
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
import { LINEAR_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  LINEAR_ATLAS_CHANNELS,
  LINEAR_ATLAS_KINDS,
  LINEAR_ATLAS_PLATFORM,
  LINEAR_ATLAS_SCHEMA_VERSION,
  type LinearAtlasEntity,
  type LinearAtlasKind,
} from "./model.js";
import { linearAtlasPaths, readLinearAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 * @internal
 */
export function linearObservations({ entity }: { entity: LinearAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: LINEAR_ATLAS_CHANNELS });
}

/**
 * Which scope one entity belongs to, as a reader sees it.
 *
 * A `setting` says which team it configures — the atlas holds every team's workflow states, and a
 * reader filtering them by scope is the whole reason the field is not a constant. Everything else is the
 * workspace: a schema is not per team, and neither is a page's route template.
 *
 * The team is read from the first channel, in declared order, whose detail names one — not from the first
 * channel with any detail, which would answer the workspace for a setting whose API detail carries no team
 * while its browser detail does.
 *
 * @param entity the stored entity
 * @returns the scope string
 * @internal
 */
export function linearEntityScope({ entity }: { entity: LinearAtlasEntity }): string {
  if (entity.kind !== "setting") {
    return LINEAR_ATLAS_PLATFORM;
  }
  for (const channel of LINEAR_ATLAS_CHANNELS) {
    const detail = entity.channels[channel]?.detail;
    if (detail !== null && typeof detail === "object") {
      const scope = (detail as { settingScope?: unknown }).settingScope;
      if (typeof scope === "string" && scope.length > 0) {
        return scope;
      }
    }
  }
  return LINEAR_ATLAS_PLATFORM;
}

/**
 * Read the Linear atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readLinearSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = linearAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readLinearAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: LINEAR_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: LINEAR_ATLAS_PLATFORM,
        remedy: "run: slopweaver atlas linear sync — it reads the whole GraphQL schema and every configuration surface",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = LINEAR_ATLAS_KINDS.map((kind: LinearAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: LINEAR_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: LINEAR_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: linearObservations({ entity }),
              providerId: entity.providerId,
              scope: linearEntityScope({ entity }),
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
    descriptor: LINEAR_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: LINEAR_ATLAS_PLATFORM,
      schemaVersion: LINEAR_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
