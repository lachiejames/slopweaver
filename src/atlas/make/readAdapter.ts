/**
 * Make's projection into the kit's normalized read view, so `slopweaver atlas make read`, `coverage` and
 * `render` work through `registry.ts` with no verb of their own.
 *
 * A store with no generation answers `generationUnpublished` naming the token step and then the fill, never
 * an empty atlas: "this organisation automates nothing" and "nobody has read it" are different sentences.
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

import { MAKE_ATLAS_DESCRIPTOR } from "./descriptor.js";
import { MAKE_TOKEN_MINT_STEPS } from "./errors.js";
import { MAKE_ATLAS_CHANNELS, MAKE_ATLAS_KINDS, MAKE_ATLAS_PLATFORM, MAKE_ATLAS_SCHEMA_VERSION } from "./model.js";
import { scenarioTable } from "./pageProjection.js";
import { makeAtlasPaths, readMakeAtlasShown } from "./store.js";

/** What to do when nothing has been published, in the order it has to happen. */
const UNPUBLISHED_REMEDY = `nothing has read Make yet. ${MAKE_TOKEN_MINT_STEPS}. Then \`slopweaver atlas make fill\` reads the organisation and publishes`;

/** The descriptor surface the stored `api` channel reads through; `browser` has none and stays named for itself. */
const CHANNEL_SURFACE: Readonly<Record<string, string>> = { api: "make-api-v2" };

/**
 * One entity's observations, each named for the descriptor surface its channel reads through.
 *
 * @param channels the stored entity's channel records
 * @returns one observation per channel that has actually looked
 */
function makeObservations({
  channels,
}: {
  channels: Parameters<typeof channelObservations>[0]["channels"];
}): readonly AtlasObservationView[] {
  return channelObservations({ channels, order: MAKE_ATLAS_CHANNELS }).map((observation) => {
    const surface = CHANNEL_SURFACE[observation.surface];
    return surface === undefined ? observation : { ...observation, surface };
  });
}

/**
 * Read the Make atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readMakeSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = makeAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  // The printing read: the token configured now is stripped from every stored string, and an unreadable
  // token file refuses the read rather than print unchecked.
  const snapshot = readMakeAtlasShown({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: MAKE_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(AtlasReadErrors.generationUnpublished({ platform: MAKE_ATLAS_PLATFORM, remedy: UNPUBLISHED_REMEDY }));
  }
  const kinds: readonly AtlasKindView[] = MAKE_ATLAS_KINDS.map((kind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: MAKE_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: MAKE_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: makeObservations({ channels: entity.channels }),
              providerId: entity.providerId,
              scope: MAKE_ATLAS_PLATFORM,
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
    descriptor: MAKE_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: MAKE_ATLAS_PLATFORM,
      schemaVersion: MAKE_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
    pageDetailTables: [scenarioTable({ kinds })],
  });
}
