/**
 * Xero's projection into the kit's normalized read view, so `slopweaver atlas xero read` and `… coverage`
 * work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Vanta and Notion adapters; what stays here is only what is genuinely Xero's —
 * which store to read, and that its scope is the platform itself, because this atlas's surfaces have no
 * account or zone to sit under.
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
import { XERO_ATLAS_DESCRIPTOR } from "./descriptor.js";
import {
  XERO_ATLAS_CHANNELS,
  XERO_ATLAS_KINDS,
  XERO_ATLAS_PLATFORM,
  XERO_ATLAS_SCHEMA_VERSION,
  type XeroAtlasEntity,
  type XeroAtlasKind,
} from "./model.js";
import { readXeroAtlas, xeroAtlasPaths } from "./store.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function xeroObservations({ entity }: { entity: XeroAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: XERO_ATLAS_CHANNELS });
}

/**
 * Read the Xero atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readXeroSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = xeroAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readXeroAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: XERO_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: XERO_ATLAS_PLATFORM,
        remedy: "run: slopweaver atlas xero sync — it reads every operation the installed client declares",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = XERO_ATLAS_KINDS.map((kind: XeroAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: XERO_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: XERO_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: xeroObservations({ entity }),
              providerId: entity.providerId,
              scope: XERO_ATLAS_PLATFORM,
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
    descriptor: XERO_ATLAS_DESCRIPTOR,
    generation: {
      mismatched,
      missing,
      platform: XERO_ATLAS_PLATFORM,
      schemaVersion: XERO_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
