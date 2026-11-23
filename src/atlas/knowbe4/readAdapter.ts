/**
 * KnowBe4's projection into the kit's normalized read view, so `slopweaver atlas knowbe4 read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * A store with no generation answers `generationUnpublished` naming the token and then the sync, never an
 * empty atlas: "nobody in this account owes training" and "nobody has read the account" are different
 * sentences, and on a compliance control the first is the more dangerous one to say by accident.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import { KNOWBE4_TOKEN_HAND_STEP } from "../../live/knowbe4/credential.js";
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
import { KNOWBE4_API_SURFACE, KNOWBE4_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  KNOWBE4_ATLAS_CHANNELS,
  KNOWBE4_ATLAS_KINDS,
  KNOWBE4_ATLAS_PLATFORM,
  KNOWBE4_ATLAS_SCHEMA_VERSION,
  type Knowbe4AtlasKind,
} from "./model.js";
import { knowbe4AtlasPaths, readKnowbe4Atlas } from "./store.js";

/** What to do when nothing has been published, in the order it has to happen. */
const UNPUBLISHED_REMEDY = `nothing has read this KnowBe4 account yet: if \`slopweaver secrets status\` shows no knowbe4-api-token, ${KNOWBE4_TOKEN_HAND_STEP}; then \`slopweaver atlas knowbe4 sync\` reads it and publishes`;

/**
 * The descriptor surface each stored channel reads through. The `api` channel IS the Reporting API surface;
 * the `browser` channel has no surface declared, and stays named for its channel so `kit/estateEvidence.ts`
 * counts it as neither authoritative nor discovery — fail-closed, as that file intends.
 */
const CHANNEL_SURFACE: Readonly<Record<string, string>> = { api: KNOWBE4_API_SURFACE };

/**
 * One entity's observations, each named for the descriptor surface its channel reads through.
 *
 * @param channels the stored entity's channel records
 * @returns one observation per channel that has actually looked
 */
function knowbe4Observations({
  channels,
}: {
  channels: Parameters<typeof channelObservations>[0]["channels"];
}): readonly AtlasObservationView[] {
  return channelObservations({ channels, order: KNOWBE4_ATLAS_CHANNELS }).map((observation) => {
    const surface = CHANNEL_SURFACE[observation.surface];
    return surface === undefined ? observation : { ...observation, surface };
  });
}

/**
 * Read the KnowBe4 atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readKnowbe4Snapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = knowbe4AtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readKnowbe4Atlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: KNOWBE4_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(AtlasReadErrors.generationUnpublished({ platform: KNOWBE4_ATLAS_PLATFORM, remedy: UNPUBLISHED_REMEDY }));
  }
  const kinds: readonly AtlasKindView[] = KNOWBE4_ATLAS_KINDS.map((kind: Knowbe4AtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: KNOWBE4_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: KNOWBE4_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: knowbe4Observations({ channels: entity.channels }),
              providerId: entity.providerId,
              scope: KNOWBE4_ATLAS_PLATFORM,
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
    descriptor: KNOWBE4_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: KNOWBE4_ATLAS_PLATFORM,
      schemaVersion: KNOWBE4_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
