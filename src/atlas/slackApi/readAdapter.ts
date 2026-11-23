/**
 * Slack's projection into the kit's normalized read view.
 *
 * The only atlas here whose browser surface is actually FILLED, so it is the one whose entities can carry a
 * `browser-discovered` deep link and a held screenshot. The channel projection itself is `kit/read.ts`'s
 * {@link channelObservations}, shared with Vanta — what is genuinely Slack's is which store to read and its
 * platform discriminator.
 *
 * That discriminator is `slack`, not `slack-api`: `kit/contract.ts` makes ONE platform per atlas a type, and
 * the workspace, the Web API and the web client are three SURFACES of one atlas. The directory is named
 * `slackApi/` for historical reasons; the registry keys on the discriminator.
 */
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
  SLACK_ATLAS_CHANNELS,
  SLACK_ATLAS_KINDS,
  SLACK_ATLAS_PLATFORM,
  SLACK_ATLAS_SCHEMA_VERSION,
  type SlackAtlasEntity,
  type SlackAtlasKind,
} from "./atlasModel.js";
import { readSlackAtlas, slackAtlasPaths } from "./atlasStore.js";
import { SLACK_ATLAS_DESCRIPTOR } from "./descriptor.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 */
export function slackObservations({ entity }: { entity: SlackAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: SLACK_ATLAS_CHANNELS });
}

/**
 * Read the Slack atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readSlackApiSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = slackAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readSlackAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: SLACK_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = SLACK_ATLAS_KINDS.map((kind: SlackAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest?.kinds[kind] ?? null;
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: SLACK_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: SLACK_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: slackObservations({ entity }),
              providerId: entity.providerId,
              scope: SLACK_ATLAS_PLATFORM,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: status?.lastSuccessAt ?? null,
      latestAttemptFailed: status?.lastAttempt?.outcome === "failed",
      permissionBlocked: status?.permissionBlocked ?? null,
      publishedCount: status?.entityCount ?? 0,
    };
  });
  return ok({
    descriptor: SLACK_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: SLACK_ATLAS_PLATFORM,
      schemaVersion: SLACK_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest?.updatedAt ?? null,
    },
    kinds,
  });
}
