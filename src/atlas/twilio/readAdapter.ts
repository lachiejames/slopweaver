/**
 * Twilio's projection into the kit's normalized read view, so `slopweaver atlas twilio read` and
 * `… coverage` work through `registry.ts` with no verb of their own.
 *
 * Two channels rather than one, so an entity projects to up to two observations — and a channel that has
 * never looked contributes nothing rather than an observation claiming it looked and found nothing. That
 * judgement is the whole two-surface design, so it lives ONCE in `kit/read.ts`'s `channelObservations` and
 * is shared with the Slack, Vanta, Notion and GitHub adapters; what stays here is only what is
 * genuinely Twilio's — which store to read, and that its scope is the platform itself, because a Twilio
 * surface has no account to sit under until a credential exists and an Account SID is an installation
 * identifier this repository does not carry.
 *
 * The descriptor a caller gets back is not the module constant: `surfaceFill.ts` derives the definition and
 * console surfaces' status from the manifest, so a generation published before a surface was filled reads
 * `declared-unfilled` for it rather than a literal somebody could edit.
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
import {
  TWILIO_ATLAS_CHANNELS,
  TWILIO_ATLAS_KINDS,
  TWILIO_ATLAS_PLATFORM,
  TWILIO_ATLAS_SCHEMA_VERSION,
  type TwilioAtlasEntity,
  type TwilioAtlasKind,
} from "./model.js";
import { readTwilioAtlas, twilioAtlasPaths } from "./store.js";
import { twilioDescriptorFor } from "./surfaceFill.js";

/**
 * Project one entity's channels into observations.
 *
 * @param entity the stored entity
 * @returns one observation per channel that has actually looked
 *
 * @internal
 */
export function twilioObservations({ entity }: { entity: TwilioAtlasEntity }): readonly AtlasObservationView[] {
  return channelObservations({ channels: entity.channels, order: TWILIO_ATLAS_CHANNELS });
}

/**
 * Read the Twilio atlas into the normalized view.
 *
 * @param home the state home to read from; omitted takes `$SLOPWEAVER_HOME`
 * @returns the snapshot, or why the store refused
 */
export function readTwilioSnapshot({ home }: { home?: string } = {}): Result<AtlasReadSnapshot, AtlasReadError> {
  const paths = twilioAtlasPaths({ home: stateHomePaths(home === undefined ? {} : { home }).root });
  const snapshot = readTwilioAtlas({ paths });
  if (snapshot.isErr()) {
    return err(AtlasReadErrors.storeUnreadable({ platform: TWILIO_ATLAS_PLATFORM, reasons: snapshot.error }));
  }
  const { files, manifest, missing, mismatched, superseded, unpublished } = snapshot.value;
  if (manifest === null) {
    return err(
      AtlasReadErrors.generationUnpublished({
        platform: TWILIO_ATLAS_PLATFORM,
        remedy:
          "run: slopweaver atlas twilio sync — it compiles every published API definition from Twilio's own pinned twilio-oai repository",
      }),
    );
  }
  const kinds: readonly AtlasKindView[] = TWILIO_ATLAS_KINDS.map((kind: TwilioAtlasKind): AtlasKindView => {
    const file = files[kind];
    const status = manifest.kinds[kind];
    return {
      coverage: file === null ? [] : coverageCellViews({ cells: file.coverage, surface: TWILIO_ATLAS_PLATFORM }),
      entities:
        file === null
          ? []
          : file.entities.map((entity) => ({
              detail: firstChannelDetail({ channels: entity.channels, order: TWILIO_ATLAS_CHANNELS }),
              id: entity.id,
              kind: entity.kind,
              observations: twilioObservations({ entity }),
              providerId: entity.providerId,
              scope: TWILIO_ATLAS_PLATFORM,
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
    descriptor: twilioDescriptorFor({ manifest }),
    generation: {
      mismatched,
      missing,
      platform: TWILIO_ATLAS_PLATFORM,
      schemaVersion: TWILIO_ATLAS_SCHEMA_VERSION,
      superseded,
      unpublished,
      updatedAt: manifest.updatedAt,
    },
    kinds,
  });
}
