/**
 * Google SecOps's projection into the kit's normalized read view, so `slopweaver atlas google-secops read`
 * and `… coverage` work through `registry.ts` with no verb of their own.
 *
 * A store with no generation answers `generationUnpublished` naming the door and then the fill, never an
 * empty atlas: "this instance has no detection rules" and "nobody has read it" are different sentences, and
 * on a security platform the first is the more dangerous one to say by accident.
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
import { GOOGLE_SECOPS_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  GOOGLE_SECOPS_ATLAS_CHANNELS,
  GOOGLE_SECOPS_ATLAS_KINDS,
  GOOGLE_SECOPS_ATLAS_PLATFORM,
  GOOGLE_SECOPS_ATLAS_SCHEMA_VERSION,
  type GoogleSecopsAtlasKind,
} from "./model.js";
import { googleSecopsAtlasPaths, readGoogleSecopsAtlas } from "./store.js";

/** What to do when nothing has been published, in the order it has to happen. */
const UNPUBLISHED_REMEDY =
  "nothing has read this instance yet. Run `slopweaver atlas google-secops connect` to consent for " +
  "`chronicle.readonly` through this door's own OAuth client, then `slopweaver atlas google-secops fill` " +
  "reads the instance under that grant; `slopweaver atlas google-secops connect --status` prints what has " +
  "been granted";

/**
 * The descriptor surface each stored channel reads through. The `api` channel IS `chronicle-api-v1`; the
 * `browser` channel has no surface declared, and stays named for its channel so `kit/estateEvidence.ts`
 * counts it as neither authoritative nor discovery — fail-closed, as that file intends.
 */
const CHANNEL_SURFACE: Readonly<Record<string, string>> = { api: "chronicle-api-v1" };

/**
 * One entity's observations, each named for the descriptor surface its channel reads through — so the
 * estate-evidence grade finds the authoritative surface that revealed it rather than an undeclared name.
 *
 * @param channels the stored entity's channel records
 * @returns one observation per channel that has actually looked
 */
function googleSecopsObservations({
  channels,
}: {
  channels: Parameters<typeof channelObservations>[0]["channels"];
}): readonly AtlasObservationView[] {
  return channelObservations({ channels, order: GOOGLE_SECOPS_ATLAS_CHANNELS }).map((observation) => {
    const surface = CHANNEL_SURFACE[observation.surface];
    return surface === undefined ? observation : { ...observation, surface };
  });
}

/**
 * Read the Google SecOps atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readGoogleSecopsSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = googleSecopsAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readGoogleSecopsAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: GOOGLE_SECOPS_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({ platform: GOOGLE_SECOPS_ATLAS_PLATFORM, remedy: UNPUBLISHED_REMEDY }),
    );
  }
  const kinds: readonly AtlasKindView[] = GOOGLE_SECOPS_ATLAS_KINDS.map(
    (kind: GoogleSecopsAtlasKind): AtlasKindView => {
      const file = files[kind];
      const status = manifest.kinds[kind];
      return {
        coverage:
          file === null ? [] : coverageCellViews({ cells: file.coverage, surface: GOOGLE_SECOPS_ATLAS_PLATFORM }),
        entities:
          file === null
            ? []
            : file.entities.map((entity) => ({
                detail: firstChannelDetail({ channels: entity.channels, order: GOOGLE_SECOPS_ATLAS_CHANNELS }),
                id: entity.id,
                kind: entity.kind,
                observations: googleSecopsObservations({ channels: entity.channels }),
                providerId: entity.providerId,
                scope: GOOGLE_SECOPS_ATLAS_PLATFORM,
              })),
        gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
        kind,
        lastSuccessAt: status.lastSuccessAt,
        latestAttemptFailed: status.lastAttempt?.outcome === "failed",
        permissionBlocked: unsetFieldAsNull({ key: "permissionBlocked", record: status }),
        publishedCount: status.entityCount,
      };
    },
  );
  return ok({
    descriptor: GOOGLE_SECOPS_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: GOOGLE_SECOPS_ATLAS_PLATFORM,
      schemaVersion: GOOGLE_SECOPS_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
