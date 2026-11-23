/**
 * 1Password's projection into the kit's normalized read view.
 *
 * THREE channels rather than Vanta's two — the admin CLI, the Events API and a browser — and the same
 * judgement applies to all of them: a channel that has never looked contributes nothing, rather than an
 * observation claiming it looked and found nothing. That lives once in `kit/read.ts`'s
 * {@link channelObservations} and is shared by every adapter; what stays here is only what is 1Password's
 * own — which store to read, and that an entity's scope is the platform itself, because a vault or a group
 * has no account or zone above it to sit under.
 */

import { absentAsNull, absentAsNumber } from "#lib/absent.js";
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
import { ONEPASSWORD_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  ONEPASSWORD_ATLAS_PLATFORM,
  ONEPASSWORD_ATLAS_SCHEMA_VERSION,
  ONEPASSWORD_CHANNELS,
  ONEPASSWORD_KINDS,
  type OnepasswordEntity,
  type OnepasswordKind,
} from "./model.js";
import { onepasswordAtlasPaths, readOnepasswordAtlas } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 */
export function onepasswordObservations({ entity }: { entity: OnepasswordEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: ONEPASSWORD_CHANNELS });
}

/**
 * Read the 1Password atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readOnepasswordSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = onepasswordAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readOnepasswordAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: ONEPASSWORD_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  const kinds: readonly AtlasKindView[] = ONEPASSWORD_KINDS.map((kind: OnepasswordKind): AtlasKindView => {
    const file = files[kind];
    const status = absentAsNull({ value: manifest?.kinds[kind] });
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: ONEPASSWORD_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: ONEPASSWORD_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: onepasswordObservations({ entity }),
              providerId: entity.providerId,
              scope: ONEPASSWORD_ATLAS_PLATFORM,
            })),
      gaps: file === null ? [] : gapViews({ gaps: file.gaps }),
      kind,
      lastSuccessAt: absentAsNull({ value: status?.lastSuccessAt }),
      latestAttemptFailed: status?.lastAttempt?.outcome === "failed",
      permissionBlocked: absentAsNull({ value: status?.permissionBlocked }),
      publishedCount: absentAsNumber({ value: status?.entityCount, whenAbsent: 0 }),
    };
  });
  return ok({
    descriptor: ONEPASSWORD_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: ONEPASSWORD_ATLAS_PLATFORM,
      schemaVersion: ONEPASSWORD_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: absentAsNull({ value: manifest?.updatedAt }),
    },
    kinds,
  });
}
